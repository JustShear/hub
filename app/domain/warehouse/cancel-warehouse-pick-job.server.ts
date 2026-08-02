import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface CancelWarehousePickJobInput {
  shopId: string;
  warehousePickJobId: string;
  reason: string;
  staffUserId: string;
}

export type CancelWarehousePickJobResult =
  { outcome: "cancelled" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

/** Administrative cancel — a plain status flip with a required reason. */
export async function cancelWarehousePickJob(
  input: CancelWarehousePickJobInput,
): Promise<CancelWarehousePickJobResult> {
  const job = await db.warehousePickJob.findFirst({
    where: { id: input.warehousePickJobId, shopId: input.shopId },
  });
  if (!job) {
    return { outcome: "rejected", reason: "Warehouse pick job not found." };
  }
  if (job.status === "CANCELLED") {
    return { outcome: "already_there" };
  }
  if (job.status === "HANDED_OVER") {
    return {
      outcome: "rejected",
      reason: "This pick job has already been handed over to packing.",
    };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required to cancel a warehouse pick job." };
  }

  await db.$transaction(async (tx) => {
    await tx.warehousePickJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: trimmedReason,
        cancelledByStaffId: input.staffUserId,
      },
    });
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: job.orderId,
        entityType: "WarehousePickJob",
        entityId: job.id,
        eventType: "warehouse_pick_job_cancelled",
        summary: `Warehouse pick job cancelled: ${trimmedReason}`,
        metadata: { reason: trimmedReason },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
  });

  return { outcome: "cancelled" };
}
