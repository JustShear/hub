import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { evaluateTaskCompletionEligibility } from "~/domain/production/task-state-machine";
import { requiresQualityCheck } from "~/domain/production/quality-checklist";
import {
  recalculateOrderProductionSummary,
  recalculateProductionJobStatus,
} from "~/domain/production/recalculate.server";

const OPEN_ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "WAITING"] as const;

export interface CompleteProductionTaskInput {
  shopId: string;
  productionTaskId: string;
  staffUserId: string;
}

export type CompleteProductionTaskResult =
  | { outcome: "completed" }
  | { outcome: "already_there" }
  | { outcome: "rejected"; reason: string; issues?: string[] };

/**
 * Completes exactly one task. A production JOB is never completed by a
 * direct action of its own — recalculateProductionJobStatus derives
 * COMPLETE automatically once every one of its non-cancelled tasks reaches
 * this status, which is what "complete a production job only when all
 * required non-cancelled tasks are complete" means in practice. Completing
 * a task never marks the order packed or fulfilled — workflowStatus is
 * untouched here entirely.
 */
export async function completeProductionTask(
  input: CompleteProductionTaskInput,
): Promise<CompleteProductionTaskResult> {
  const task = await db.productionTask.findFirst({
    where: { id: input.productionTaskId, productionJob: { shopId: input.shopId } },
    include: { productionJob: { select: { orderId: true } } },
  });
  if (!task) {
    return { outcome: "rejected", reason: "Production task not found." };
  }
  if (task.status === "COMPLETE") {
    return { outcome: "already_there" };
  }

  const openBlockingIssueCount = await db.productionIssue.count({
    where: {
      productionTaskId: task.id,
      isBlocking: true,
      status: { in: [...OPEN_ISSUE_STATUSES] },
    },
  });

  const eligibility = evaluateTaskCompletionEligibility({
    status: task.status,
    requiredQuantity: task.requiredQuantity,
    completedQuantity: task.completedQuantity,
    failedQuantity: task.failedQuantity,
    qualityApprovedQuantity: task.qualityApprovedQuantity,
    requiresQualityCheck: requiresQualityCheck(task.decorationMethod),
    hasOpenBlockingIssue: openBlockingIssueCount > 0,
  });
  if (!eligibility.allowed) {
    return {
      outcome: "rejected",
      reason: eligibility.reason ?? "This task can't be completed yet.",
    };
  }

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.productionTask.updateMany({
      where: { id: task.id, status: { notIn: ["COMPLETE", "CANCELLED", "FAILED"] } },
      data: {
        status: "COMPLETE",
        completedAt: new Date(),
        completedByStaffId: input.staffUserId,
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) return { alreadyDone: true as const };

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: task.productionJob.orderId,
        entityType: "ProductionTask",
        entityId: task.id,
        eventType: "production_task_completed",
        summary: "Production task completed",
        metadata: { completedQuantity: task.completedQuantity },
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
    return { alreadyDone: false as const };
  });

  return transactionResult.alreadyDone ? { outcome: "already_there" } : { outcome: "completed" };
}

export interface CancelProductionTaskInput {
  shopId: string;
  productionTaskId: string;
  reason: string;
  markFailed: boolean;
  staffUserId: string;
}

export type CancelProductionTaskResult =
  { outcome: "cancelled" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

/**
 * Administratively closes a task without completing it — CANCELLED for
 * "no longer needed," FAILED for "abandoned as unsuccessful." Never
 * affects a sibling task on the same job.
 */
export async function cancelProductionTask(
  input: CancelProductionTaskInput,
): Promise<CancelProductionTaskResult> {
  const task = await db.productionTask.findFirst({
    where: { id: input.productionTaskId, productionJob: { shopId: input.shopId } },
    include: { productionJob: { select: { orderId: true } } },
  });
  if (!task) {
    return { outcome: "rejected", reason: "Production task not found." };
  }
  const targetStatus = input.markFailed ? "FAILED" : "CANCELLED";
  if (task.status === targetStatus) {
    return { outcome: "already_there" };
  }
  if (task.status === "COMPLETE") {
    return {
      outcome: "rejected",
      reason: "A completed task can't be cancelled — reopen it first.",
    };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required." };
  }

  await db.$transaction(async (tx) => {
    const updateResult = await tx.productionTask.updateMany({
      where: { id: task.id, status: { notIn: ["COMPLETE", "CANCELLED", "FAILED"] } },
      data: {
        status: targetStatus,
        cancelledAt: new Date(),
        cancelReason: trimmedReason,
        cancelledByStaffId: input.staffUserId,
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) return;

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: task.productionJob.orderId,
        entityType: "ProductionTask",
        entityId: task.id,
        eventType: input.markFailed ? "production_task_failed" : "production_task_cancelled",
        summary: `Production task ${input.markFailed ? "marked failed" : "cancelled"}: ${trimmedReason}`,
        metadata: { reason: trimmedReason, previousStatus: task.status },
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

  return { outcome: "cancelled" };
}
