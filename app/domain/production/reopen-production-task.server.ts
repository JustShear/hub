import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { deriveTaskWorkingStatus } from "~/domain/production/task-state-machine";
import { requiresQualityCheck } from "~/domain/production/quality-checklist";
import {
  recalculateOrderProductionSummary,
  recalculateProductionJobStatus,
} from "~/domain/production/recalculate.server";

export interface ReopenProductionTaskInput {
  shopId: string;
  productionTaskId: string;
  reason: string;
  staffUserId: string;
}

export type ReopenProductionTaskResult =
  { outcome: "reopened"; newStatus: string } | { outcome: "rejected"; reason: string };

/**
 * Reopens a completed task via the existing ManualOverride framework
 * (OverrideType.REOPEN_COMPLETED_PRODUCTION) — never erases the original
 * completion event (ActivityEvent rows are never deleted), and the new
 * working status is derived from the task's own quantities, not
 * reconstructed from a separately-stored "previous status."
 */
export async function reopenProductionTask(
  input: ReopenProductionTaskInput,
): Promise<ReopenProductionTaskResult> {
  const task = await db.productionTask.findFirst({
    where: { id: input.productionTaskId, productionJob: { shopId: input.shopId } },
    include: { productionJob: { select: { orderId: true } } },
  });
  if (!task) {
    return { outcome: "rejected", reason: "Production task not found." };
  }
  if (task.status !== "COMPLETE") {
    return { outcome: "rejected", reason: "Only a completed task can be reopened." };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required to reopen completed work." };
  }

  const nextStatus = deriveTaskWorkingStatus({
    requiredQuantity: task.requiredQuantity,
    completedQuantity: task.completedQuantity,
    failedQuantity: task.failedQuantity,
    qualityApprovedQuantity: task.qualityApprovedQuantity,
    requiresQualityCheck: requiresQualityCheck(task.decorationMethod),
    hasPendingQualityCheckFailure: task.failedQuantity > 0,
  });

  await db.$transaction(async (tx) => {
    const updateResult = await tx.productionTask.updateMany({
      where: { id: task.id, status: "COMPLETE" },
      data: {
        status: nextStatus,
        reopenedAt: new Date(),
        reopenReason: trimmedReason,
        reopenedByStaffId: input.staffUserId,
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) return;

    await tx.manualOverride.create({
      data: {
        shopId: input.shopId,
        overrideType: "REOPEN_COMPLETED_PRODUCTION",
        relatedEntityType: "ProductionTask",
        relatedEntityId: task.id,
        previousValue: { status: "COMPLETE", completedAt: task.completedAt?.toISOString() ?? null },
        newValue: { status: nextStatus },
        reason: trimmedReason,
        staffUserId: input.staffUserId,
      },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: task.productionJob.orderId,
        entityType: "ProductionTask",
        entityId: task.id,
        eventType: "production_task_reopened",
        summary: `Production task reopened: ${trimmedReason}`,
        metadata: { reason: trimmedReason, newStatus: nextStatus },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    await recalculateProductionJobStatus(tx, {
      jobId: task.productionJobId,
      actorStaffId: input.staffUserId,
    });
    await recalculateOrderProductionSummary(tx, {
      shopId: input.shopId,
      orderId: task.productionJob.orderId,
      actorStaffId: input.staffUserId,
    });
  });

  return { outcome: "reopened", newStatus: nextStatus };
}
