import { ActorType, DueDateSource, OverrideType, Prisma, type DueDateType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { DUE_DATE_TYPE_LABELS } from "~/domain/orders/labels";
import { formatAuDate } from "~/lib/dates";

export type SetDueDateResult =
  | { outcome: "set"; dueDate: string | null }
  | { outcome: "already_there"; dueDate: string | null }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualDueDate: string | null };

export interface SetDueDateInput {
  shopId: string;
  orderId: string;
  type: DueDateType;
  /** null clears the due date. */
  targetDueDate: Date | null;
  /** What the client observed when it initiated the change — guards against a stale edit. */
  expectedDueDate: Date | null;
  /** Required — OverrideType.CHANGE_DUE_DATE already exists in the manual-override framework for exactly this. */
  reason: string;
  staffUserId: string;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.getTime() === b.getTime();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Due-date edits are a manual override by the SRS's own framework
// (OverrideType.CHANGE_DUE_DATE already exists for this) — a reason is
// always required, and a ManualOverride row is recorded alongside the
// OrderDueDate change and the ActivityEvent. Same compare-and-swap
// idempotency pattern as the rest of the drawer's edits.
export async function setOrderDueDate(input: SetDueDateInput): Promise<SetDueDateResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: { id: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  if (input.targetDueDate && Number.isNaN(input.targetDueDate.getTime())) {
    return { outcome: "rejected", reason: "That due date isn't valid." };
  }

  const existing = await db.orderDueDate.findUnique({
    where: { orderId_type: { orderId: input.orderId, type: input.type } },
  });
  const currentDueDate = existing?.dueDate ?? null;

  if (sameInstant(currentDueDate, input.targetDueDate)) {
    return { outcome: "already_there", dueDate: currentDueDate?.toISOString() ?? null };
  }

  if (!sameInstant(currentDueDate, input.expectedDueDate)) {
    return {
      outcome: "conflict",
      reason: "This due date changed since you last saw it. Refresh to see the current value.",
      actualDueDate: currentDueDate?.toISOString() ?? null,
    };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required when changing a due date." };
  }

  let affectedRowId: string;

  if (input.targetDueDate === null) {
    if (!existing) {
      // sameInstant(currentDueDate, null) would already have matched above —
      // unreachable in practice, but a safe fallback rather than an assertion.
      return { outcome: "already_there", dueDate: null };
    }
    const deleteResult = await db.orderDueDate.deleteMany({
      where: { orderId: input.orderId, type: input.type, dueDate: existing.dueDate },
    });
    if (deleteResult.count === 0) {
      const latest = await db.orderDueDate.findUnique({
        where: { orderId_type: { orderId: input.orderId, type: input.type } },
      });
      return {
        outcome: "conflict",
        reason: "This due date changed since you last saw it. Refresh to see the current value.",
        actualDueDate: latest?.dueDate.toISOString() ?? null,
      };
    }
    affectedRowId = existing.id;
  } else if (existing) {
    const updateResult = await db.orderDueDate.updateMany({
      where: { orderId: input.orderId, type: input.type, dueDate: existing.dueDate },
      data: {
        dueDate: input.targetDueDate,
        source: DueDateSource.MANUAL_OVERRIDE,
        setByStaffId: input.staffUserId,
        overrideReason: trimmedReason,
      },
    });
    if (updateResult.count === 0) {
      const latest = await db.orderDueDate.findUnique({
        where: { orderId_type: { orderId: input.orderId, type: input.type } },
      });
      return {
        outcome: "conflict",
        reason: "This due date changed since you last saw it. Refresh to see the current value.",
        actualDueDate: latest?.dueDate.toISOString() ?? null,
      };
    }
    affectedRowId = existing.id;
  } else {
    try {
      const created = await db.orderDueDate.create({
        data: {
          orderId: input.orderId,
          type: input.type,
          dueDate: input.targetDueDate,
          source: DueDateSource.MANUAL_OVERRIDE,
          setByStaffId: input.staffUserId,
          overrideReason: trimmedReason,
        },
      });
      affectedRowId = created.id;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const latest = await db.orderDueDate.findUnique({
          where: { orderId_type: { orderId: input.orderId, type: input.type } },
        });
        return {
          outcome: "conflict",
          reason: "This due date changed since you last saw it. Refresh to see the current value.",
          actualDueDate: latest?.dueDate.toISOString() ?? null,
        };
      }
      throw error;
    }
  }

  const typeLabel = DUE_DATE_TYPE_LABELS[input.type];
  const summary = input.targetDueDate
    ? `${typeLabel} due date set to ${formatAuDate(input.targetDueDate)}`
    : `${typeLabel} due date cleared`;

  await db.$transaction([
    db.manualOverride.create({
      data: {
        shopId: input.shopId,
        overrideType: OverrideType.CHANGE_DUE_DATE,
        relatedEntityType: "OrderDueDate",
        relatedEntityId: affectedRowId,
        previousValue: currentDueDate ? { dueDate: currentDueDate.toISOString() } : Prisma.JsonNull,
        newValue: input.targetDueDate
          ? { dueDate: input.targetDueDate.toISOString() }
          : Prisma.JsonNull,
        reason: trimmedReason,
        staffUserId: input.staffUserId,
      },
    }),
    db.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        entityType: "ShopifyOrder",
        entityId: input.orderId,
        eventType: "due_date_changed",
        summary,
        metadata: {
          type: input.type,
          previousDueDate: currentDueDate?.toISOString() ?? null,
          newDueDate: input.targetDueDate?.toISOString() ?? null,
          reason: trimmedReason,
          source: "order_drawer",
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    }),
  ]);

  return { outcome: "set", dueDate: input.targetDueDate?.toISOString() ?? null };
}
