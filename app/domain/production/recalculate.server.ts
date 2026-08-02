import { ActorType, type Prisma, type PrismaClient } from "@prisma/client";
import { deriveProductionJobStatus } from "~/domain/production/job-state-machine";
import { calculateOrderProductionSummary } from "~/domain/production/order-production-summary";
import {
  PRODUCTION_JOB_STATUS_LABELS,
  ORDER_PRODUCTION_SUMMARY_LABELS,
} from "~/domain/production/labels";
import { createWarehousePickJobForOrder } from "~/domain/warehouse/create-warehouse-pick-job.server";

type TxClient = Prisma.TransactionClient | PrismaClient;

const OPEN_ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "WAITING"] as const;

/**
 * The one writer of ProductionJob.status. Must be called at the end of
 * every production-domain mutation that could change a task under this
 * job, inside the same transaction as that mutation's other writes. A
 * no-op when the recalculated value already matches what's stored — never
 * fabricates a change that didn't happen. Cancelled jobs are never
 * recalculated (cancellation is its own terminal action).
 */
export async function recalculateProductionJobStatus(
  tx: TxClient,
  params: { jobId: string; actorStaffId: string | null },
): Promise<void> {
  const job = await tx.productionJob.findUniqueOrThrow({ where: { id: params.jobId } });
  if (job.status === "CANCELLED") return;

  const tasks = await tx.productionTask.findMany({
    where: { productionJobId: params.jobId, status: { not: "CANCELLED" } },
    select: { status: true },
  });
  const newStatus = deriveProductionJobStatus(tasks);
  if (newStatus === job.status) return;

  await tx.productionJob.update({
    where: { id: job.id },
    data: {
      status: newStatus,
      startedAt: newStatus === "IN_PROGRESS" && !job.startedAt ? new Date() : undefined,
      completedAt: newStatus === "COMPLETE" && !job.completedAt ? new Date() : undefined,
    },
  });
  await tx.activityEvent.create({
    data: {
      shopId: job.shopId,
      orderId: job.orderId,
      entityType: "ProductionJob",
      entityId: job.id,
      eventType: "production_job_status_changed",
      summary: `Production job ${job.jobNumber} changed from ${PRODUCTION_JOB_STATUS_LABELS[job.status]} to ${PRODUCTION_JOB_STATUS_LABELS[newStatus]}`,
      metadata: { previousStatus: job.status, newStatus },
      actorStaffId: params.actorStaffId,
      actorType: params.actorStaffId ? ActorType.STAFF : ActorType.SYSTEM,
    },
  });
}

async function hasExportedArtworkWithoutJob(tx: TxClient, orderId: string): Promise<boolean> {
  const count = await tx.exportBatchItem.count({
    where: {
      exportBatch: { orderId, status: "EXPORTED" },
      productionTask: null,
    },
  });
  return count > 0;
}

/**
 * The one writer of ShopifyOrder.productionSummary. Must be called at the
 * end of every production-domain mutation, inside the same transaction as
 * that mutation's other writes — mirrors recalculateOrderProofSummary's
 * exact convention. A no-op when the recalculated value already matches
 * what's stored.
 */
export async function recalculateOrderProductionSummary(
  tx: TxClient,
  params: { shopId: string; orderId: string; actorStaffId: string | null },
): Promise<void> {
  const order = await tx.shopifyOrder.findUniqueOrThrow({
    where: { id: params.orderId },
    select: { productionSummary: true },
  });

  const tasks = await tx.productionTask.findMany({
    where: {
      productionJob: { orderId: params.orderId, status: { not: "CANCELLED" } },
      status: { not: "CANCELLED" },
    },
    select: { id: true, status: true },
  });

  const openIssueTaskIds = new Set(
    (
      await tx.productionIssue.findMany({
        where: {
          productionTaskId: { in: tasks.map((t) => t.id) },
          isBlocking: true,
          status: { in: [...OPEN_ISSUE_STATUSES] },
        },
        select: { productionTaskId: true },
      })
    )
      .map((i) => i.productionTaskId)
      .filter((id): id is string => id !== null),
  );

  const summaryInputs = tasks.map((t) => ({
    status: t.status,
    hasOpenBlockingIssue: openIssueTaskIds.has(t.id),
  }));

  const exportedWithoutJob = await hasExportedArtworkWithoutJob(tx, params.orderId);
  const newSummary = calculateOrderProductionSummary(summaryInputs, exportedWithoutJob);

  if (newSummary === order.productionSummary) return;

  await tx.shopifyOrder.update({
    where: { id: params.orderId },
    data: { productionSummary: newSummary },
  });
  await tx.activityEvent.create({
    data: {
      shopId: params.shopId,
      orderId: params.orderId,
      entityType: "ShopifyOrder",
      entityId: params.orderId,
      eventType: "order_production_summary_changed",
      summary: `Order production summary changed from ${ORDER_PRODUCTION_SUMMARY_LABELS[order.productionSummary]} to ${ORDER_PRODUCTION_SUMMARY_LABELS[newSummary]}`,
      metadata: { previousSummary: order.productionSummary, newSummary },
      actorStaffId: params.actorStaffId,
      actorType: params.actorStaffId ? ActorType.STAFF : ActorType.SYSTEM,
    },
  });

  // Milestone 13 — the moment production genuinely completes, a warehouse
  // pick job exists for staff to gather the order. Same transaction: pure
  // DB writes, no external I/O, so this is safe to keep atomic with the
  // summary flip rather than a separate follow-up step.
  if (newSummary === "COMPLETE") {
    await createWarehousePickJobForOrder(tx, {
      shopId: params.shopId,
      orderId: params.orderId,
      actorStaffId: params.actorStaffId,
    });
  }
}
