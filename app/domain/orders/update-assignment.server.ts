import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { DRAWER_ASSIGNMENT_ROLE } from "~/domain/orders/order-detail-query.server";

export type UpdateAssignmentResult =
  | { outcome: "updated"; staffUserId: string | null; staffUserName: string | null }
  | { outcome: "already_there"; staffUserId: string | null }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualStaffUserId: string | null };

export interface UpdateAssignmentInput {
  shopId: string;
  orderId: string;
  /** null clears the assignment. */
  targetStaffUserId: string | null;
  /** What the client observed when it initiated the change — guards against a stale edit. */
  expectedStaffUserId: string | null;
  staffUserId: string;
}

// Single-slot assignment editing (the ARTWORK role — see DRAWER_ASSIGNMENT_ROLE)
// with the same compare-and-swap idempotency pattern as Milestone 06B's
// moveOrderWorkflowStatus: check "already there" before "matches expectation"
// so an exact duplicate retry is a safe no-op, not a conflict.
export async function updateOrderAssignment(
  input: UpdateAssignmentInput,
): Promise<UpdateAssignmentResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: { id: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  const current = await db.orderAssignment.findFirst({
    where: { orderId: input.orderId, role: DRAWER_ASSIGNMENT_ROLE, unassignedAt: null },
  });
  const currentStaffUserId = current?.staffUserId ?? null;

  if (currentStaffUserId === input.targetStaffUserId) {
    return { outcome: "already_there", staffUserId: currentStaffUserId };
  }

  if (currentStaffUserId !== input.expectedStaffUserId) {
    return {
      outcome: "conflict",
      reason:
        "This order's assignment changed since you last saw it. Refresh to see the current value.",
      actualStaffUserId: currentStaffUserId,
    };
  }

  let targetStaffName: string | null = null;
  if (input.targetStaffUserId) {
    const targetStaff = await db.staffUser.findFirst({
      where: { id: input.targetStaffUserId, shopId: input.shopId, isActive: true },
    });
    if (!targetStaff) {
      return { outcome: "rejected", reason: "That staff member is not active or doesn't exist." };
    }
    targetStaffName = targetStaff.name;
  }

  const currentStaffName = current
    ? ((
        await db.staffUser.findUnique({
          where: { id: current.staffUserId },
          select: { name: true },
        })
      )?.name ?? "a former staff member")
    : null;

  const transactionResult = await db.$transaction(async (tx) => {
    if (current) {
      const closeResult = await tx.orderAssignment.updateMany({
        where: { id: current.id, unassignedAt: null },
        data: { unassignedAt: new Date() },
      });
      if (closeResult.count === 0) {
        return { conflict: true as const };
      }
    }
    if (input.targetStaffUserId) {
      await tx.orderAssignment.create({
        data: {
          orderId: input.orderId,
          staffUserId: input.targetStaffUserId,
          role: DRAWER_ASSIGNMENT_ROLE,
        },
      });
    }
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        entityType: "ShopifyOrder",
        entityId: input.orderId,
        eventType: "assignment_changed",
        summary: `Assignment changed from ${currentStaffName ?? "Unassigned"} to ${targetStaffName ?? "Unassigned"}`,
        metadata: {
          previousStaffUserId: currentStaffUserId,
          newStaffUserId: input.targetStaffUserId,
          source: "order_drawer",
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return { conflict: false as const };
  });

  if (transactionResult.conflict) {
    const latest = await db.orderAssignment.findFirst({
      where: { orderId: input.orderId, role: DRAWER_ASSIGNMENT_ROLE, unassignedAt: null },
    });
    return {
      outcome: "conflict",
      reason:
        "This order's assignment changed since you last saw it. Refresh to see the current value.",
      actualStaffUserId: latest?.staffUserId ?? null,
    };
  }

  return {
    outcome: "updated",
    staffUserId: input.targetStaffUserId,
    staffUserName: targetStaffName,
  };
}
