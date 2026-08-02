import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { calculateShortQuantity } from "~/domain/warehouse/pick-quantity-validation";
import { derivePickItemStatus } from "~/domain/warehouse/pick-item-state";
import { recalculateWarehousePickJobStatus } from "~/domain/warehouse/recalculate.server";

export interface MarkPickItemShortInput {
  shopId: string;
  warehousePickItemId: string;
  reason: string;
  staffUserId: string;
}

export type MarkPickItemShortResult =
  { outcome: "marked"; shortQuantity: number } | { outcome: "rejected"; reason: string };

/**
 * Marks whatever remains unaccounted for on a line as short — a deliberate
 * staff declaration ("we physically can't fulfil the rest"), distinct from
 * an ordinary partial pick still expecting more. Per this milestone's own
 * scope decision, a short pick does NOT block handover — it auto-creates a
 * non-blocking WarehouseIssue (STOCK_SHORTAGE) documenting the shortage,
 * mirroring perform-quality-check.server.ts's auto-issue-on-rework pattern.
 */
export async function markPickItemShort(
  input: MarkPickItemShortInput,
): Promise<MarkPickItemShortResult> {
  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required to mark a line short." };
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

  const calculation = calculateShortQuantity({
    requiredQuantity: item.requiredQuantity,
    currentPickedQuantity: item.pickedQuantity,
    currentShortQuantity: item.shortQuantity,
  });
  if (!calculation.valid || calculation.shortQuantity === undefined) {
    return { outcome: "rejected", reason: calculation.reason ?? "Nothing remains to mark short." };
  }
  const nextShort = calculation.shortQuantity;

  await db.$transaction(async (tx) => {
    const nextStatus = derivePickItemStatus(item.pickedQuantity, nextShort, item.requiredQuantity);

    await tx.warehousePickItem.update({
      where: { id: item.id },
      data: { shortQuantity: nextShort, status: nextStatus, shortReason: trimmedReason },
    });

    await tx.warehouseIssue.create({
      data: {
        shopId: input.shopId,
        orderId: item.warehousePickJob.orderId,
        warehousePickJobId: item.warehousePickJob.id,
        warehousePickItemId: item.id,
        issueType: "STOCK_SHORTAGE",
        severity: "MEDIUM",
        description: trimmedReason,
        isBlocking: false,
        createdByStaffId: input.staffUserId,
      },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: item.warehousePickJob.orderId,
        entityType: "WarehousePickItem",
        entityId: item.id,
        eventType: "warehouse_pick_item_marked_short",
        summary: `Marked ${nextShort - item.shortQuantity} unit(s) short: ${trimmedReason}`,
        metadata: { shortQuantity: nextShort, reason: trimmedReason },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    await recalculateWarehousePickJobStatus(tx, {
      jobId: item.warehousePickJob.id,
      actorStaffId: input.staffUserId,
    });
  });

  return { outcome: "marked", shortQuantity: nextShort };
}
