import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";
import { validatePickQuantityUpdate } from "~/domain/warehouse/pick-quantity-validation";
import { derivePickItemStatus } from "~/domain/warehouse/pick-item-state";
import { recalculateWarehousePickJobStatus } from "~/domain/warehouse/recalculate.server";

export interface RecordPickQuantityInput {
  shopId: string;
  warehousePickItemId: string;
  newlyPickedQuantity: number;
  idempotencyKey: string;
  staffUserId: string;
}

export type RecordPickQuantityResult =
  | { outcome: "recorded"; pickedQuantity: number }
  | { outcome: "duplicate"; pickedQuantity: number }
  | { outcome: "rejected"; reason: string };

/**
 * The one place picked quantities are recorded. The @@unique constraint on
 * WarehousePickQuantityUpdate(warehousePickItemId, idempotencyKey) is the
 * real duplicate-submission guard — a retried request with the same key
 * can never increment the item's quantity twice. Mirrors
 * record-production-quantity.server.ts closely, without the
 * quality-check/rework dimensions production has.
 */
export async function recordPickQuantity(
  input: RecordPickQuantityInput,
): Promise<RecordPickQuantityResult> {
  const existing = await db.warehousePickQuantityUpdate.findUnique({
    where: {
      warehousePickItemId_idempotencyKey: {
        warehousePickItemId: input.warehousePickItemId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    const item = await db.warehousePickItem.findUniqueOrThrow({
      where: { id: input.warehousePickItemId },
      select: { pickedQuantity: true },
    });
    return { outcome: "duplicate", pickedQuantity: item.pickedQuantity };
  }

  const item = await db.warehousePickItem.findFirst({
    where: { id: input.warehousePickItemId, warehousePickJob: { shopId: input.shopId } },
    include: { warehousePickJob: { select: { id: true, orderId: true, status: true } } },
  });
  if (!item) {
    return { outcome: "rejected", reason: "Warehouse pick item not found." };
  }
  if (
    item.warehousePickJob.status === "HANDED_OVER" ||
    item.warehousePickJob.status === "CANCELLED"
  ) {
    return { outcome: "rejected", reason: "This pick job has already reached a terminal state." };
  }

  const openBlockingIssue = await db.warehouseIssue.findFirst({
    where: {
      warehousePickItemId: item.id,
      isBlocking: true,
      status: { in: ["OPEN", "INVESTIGATING", "WAITING"] },
    },
  });
  if (openBlockingIssue) {
    return {
      outcome: "rejected",
      reason: "This line is blocked by an open issue — resolve it before recording a pick.",
    };
  }

  const validation = validatePickQuantityUpdate({
    requiredQuantity: item.requiredQuantity,
    currentPickedQuantity: item.pickedQuantity,
    currentShortQuantity: item.shortQuantity,
    newlyPickedQuantity: input.newlyPickedQuantity,
  });
  if (!validation.valid || validation.nextPickedQuantity === undefined) {
    return { outcome: "rejected", reason: validation.reason ?? "Invalid quantity update." };
  }
  const nextPicked = validation.nextPickedQuantity;

  try {
    const result = await db.$transaction(async (tx) => {
      await tx.warehousePickQuantityUpdate.create({
        data: {
          warehousePickItemId: item.id,
          quantity: input.newlyPickedQuantity,
          idempotencyKey: input.idempotencyKey,
          staffUserId: input.staffUserId,
        },
      });

      const nextStatus = derivePickItemStatus(
        nextPicked,
        item.shortQuantity,
        item.requiredQuantity,
      );

      await tx.warehousePickItem.update({
        where: { id: item.id },
        data: { pickedQuantity: nextPicked, status: nextStatus },
      });

      await tx.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: item.warehousePickJob.orderId,
          entityType: "WarehousePickItem",
          entityId: item.id,
          eventType: "warehouse_pick_quantity_recorded",
          summary: `Picked +${input.newlyPickedQuantity} (${nextPicked}/${item.requiredQuantity})`,
          metadata: { newlyPickedQuantity: input.newlyPickedQuantity, pickedQuantity: nextPicked },
          actorStaffId: input.staffUserId,
          actorType: ActorType.STAFF,
        },
      });

      await recalculateWarehousePickJobStatus(tx, {
        jobId: item.warehousePickJob.id,
        actorStaffId: input.staffUserId,
      });

      return { pickedQuantity: nextPicked };
    });

    return { outcome: "recorded", ...result };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const item2 = await db.warehousePickItem.findUniqueOrThrow({
        where: { id: input.warehousePickItemId },
        select: { pickedQuantity: true },
      });
      return { outcome: "duplicate", pickedQuantity: item2.pickedQuantity };
    }
    throw error;
  }
}
