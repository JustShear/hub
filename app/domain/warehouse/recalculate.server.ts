import { ActorType, type Prisma, type PrismaClient } from "@prisma/client";
import { derivePickJobStatus } from "~/domain/warehouse/pick-job-state";
import { WAREHOUSE_PICK_JOB_STATUS_LABELS } from "~/domain/warehouse/labels";

type TxClient = Prisma.TransactionClient | PrismaClient;

/**
 * The one writer of WarehousePickJob.status outside the explicit handover/
 * cancel actions. Must be called at the end of every item-level mutation,
 * inside the same transaction as that mutation's other writes — mirrors
 * recalculateProductionJobStatus's exact convention. A no-op when the
 * recalculated value already matches what's stored, and never touches a
 * job that's already reached a terminal state (HANDED_OVER/CANCELLED).
 */
export async function recalculateWarehousePickJobStatus(
  tx: TxClient,
  params: { jobId: string; actorStaffId: string | null },
): Promise<void> {
  const job = await tx.warehousePickJob.findUniqueOrThrow({ where: { id: params.jobId } });
  if (job.status === "HANDED_OVER" || job.status === "CANCELLED") return;

  const items = await tx.warehousePickItem.findMany({
    where: { warehousePickJobId: params.jobId },
    select: { status: true },
  });
  const newStatus = derivePickJobStatus(items, job.status);
  if (newStatus === job.status) return;

  await tx.warehousePickJob.update({
    where: { id: job.id },
    data: {
      status: newStatus,
      startedAt: newStatus === "IN_PROGRESS" && !job.startedAt ? new Date() : undefined,
    },
  });
  await tx.activityEvent.create({
    data: {
      shopId: job.shopId,
      orderId: job.orderId,
      entityType: "WarehousePickJob",
      entityId: job.id,
      eventType: "warehouse_pick_job_status_changed",
      summary: `Warehouse pick job changed from ${WAREHOUSE_PICK_JOB_STATUS_LABELS[job.status]} to ${WAREHOUSE_PICK_JOB_STATUS_LABELS[newStatus]}`,
      metadata: { previousStatus: job.status, newStatus },
      actorStaffId: params.actorStaffId,
      actorType: params.actorStaffId ? ActorType.STAFF : ActorType.SYSTEM,
    },
  });
}
