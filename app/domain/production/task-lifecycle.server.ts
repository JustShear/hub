import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { canPauseTask, canResumeTask, canStartTask } from "~/domain/production/task-state-machine";
import { validatePauseReason } from "~/domain/production/pause-reason";
import {
  recalculateProductionJobStatus,
  recalculateOrderProductionSummary,
} from "~/domain/production/recalculate.server";

const OPEN_ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "WAITING"] as const;

async function loadTaskContext(shopId: string, productionTaskId: string) {
  const task = await db.productionTask.findFirst({
    where: { id: productionTaskId, productionJob: { shopId } },
    include: {
      productionJob: { include: { order: { select: { id: true, cancelledAt: true } } } },
    },
  });
  if (!task) return null;
  const openBlockingIssueCount = await db.productionIssue.count({
    where: { productionTaskId, isBlocking: true, status: { in: [...OPEN_ISSUE_STATUSES] } },
  });
  return { task, openBlockingIssueCount };
}

export interface StartProductionTaskInput {
  shopId: string;
  productionTaskId: string;
  staffUserId: string;
}

export type StartProductionTaskResult =
  { outcome: "started" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function startProductionTask(
  input: StartProductionTaskInput,
): Promise<StartProductionTaskResult> {
  const context = await loadTaskContext(input.shopId, input.productionTaskId);
  if (!context) return { outcome: "rejected", reason: "Production task not found." };
  const { task, openBlockingIssueCount } = context;

  if (task.status === "IN_PROGRESS") {
    return { outcome: "already_there" };
  }
  if (task.productionJob.order.cancelledAt) {
    return { outcome: "rejected", reason: "This order is cancelled." };
  }
  if (task.productionJob.status === "CANCELLED") {
    return { outcome: "rejected", reason: "This production job is cancelled." };
  }
  if (openBlockingIssueCount > 0) {
    return {
      outcome: "rejected",
      reason: "This task has an unresolved blocking issue and can't be started.",
    };
  }
  const eligibility = canStartTask(task.status);
  if (!eligibility.allowed) {
    return { outcome: "rejected", reason: eligibility.reason ?? "This task can't be started." };
  }

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.productionTask.updateMany({
      where: { id: task.id, status: task.status },
      data: {
        status: "IN_PROGRESS",
        startedAt: task.startedAt ?? new Date(),
        pausedAt: null,
        pauseReason: null,
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
        eventType: "production_task_started",
        summary: "Production task started",
        metadata: { previousStatus: task.status },
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

  return transactionResult.alreadyDone ? { outcome: "already_there" } : { outcome: "started" };
}

export interface PauseProductionTaskInput {
  shopId: string;
  productionTaskId: string;
  reasonCode: string;
  otherText: string | null;
  staffUserId: string;
}

export type PauseProductionTaskResult =
  { outcome: "paused" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function pauseProductionTask(
  input: PauseProductionTaskInput,
): Promise<PauseProductionTaskResult> {
  const context = await loadTaskContext(input.shopId, input.productionTaskId);
  if (!context) return { outcome: "rejected", reason: "Production task not found." };
  const { task } = context;

  if (task.status === "PAUSED") {
    return { outcome: "already_there" };
  }
  const eligibility = canPauseTask(task.status);
  if (!eligibility.allowed) {
    return { outcome: "rejected", reason: eligibility.reason ?? "This task can't be paused." };
  }
  const reasonResult = validatePauseReason({
    reasonCode: input.reasonCode,
    otherText: input.otherText,
  });
  if (!reasonResult.valid) {
    return { outcome: "rejected", reason: reasonResult.error };
  }

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.productionTask.updateMany({
      where: { id: task.id, status: "IN_PROGRESS" },
      data: {
        status: "PAUSED",
        pausedAt: new Date(),
        pauseReason: reasonResult.storedReason,
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
        eventType: "production_task_paused",
        summary: `Production task paused — ${reasonResult.storedReason}`,
        metadata: { reason: reasonResult.storedReason },
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

  return transactionResult.alreadyDone ? { outcome: "already_there" } : { outcome: "paused" };
}

export interface ResumeProductionTaskInput {
  shopId: string;
  productionTaskId: string;
  staffUserId: string;
}

export type ResumeProductionTaskResult =
  { outcome: "resumed" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function resumeProductionTask(
  input: ResumeProductionTaskInput,
): Promise<ResumeProductionTaskResult> {
  const context = await loadTaskContext(input.shopId, input.productionTaskId);
  if (!context) return { outcome: "rejected", reason: "Production task not found." };
  const { task, openBlockingIssueCount } = context;

  if (task.status === "IN_PROGRESS") {
    return { outcome: "already_there" };
  }
  if (openBlockingIssueCount > 0) {
    return {
      outcome: "rejected",
      reason: "This task has an unresolved blocking issue and can't be resumed.",
    };
  }
  const eligibility = canResumeTask(task.status);
  if (!eligibility.allowed) {
    return { outcome: "rejected", reason: eligibility.reason ?? "This task can't be resumed." };
  }

  const pausedDurationMs = task.pausedAt ? Date.now() - task.pausedAt.getTime() : 0;

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.productionTask.updateMany({
      where: { id: task.id, status: "PAUSED" },
      data: {
        status: "IN_PROGRESS",
        pausedAt: null,
        pauseReason: null,
        totalPausedDurationMs: { increment: pausedDurationMs },
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
        eventType: "production_task_resumed",
        summary: "Production task resumed",
        metadata: { pausedDurationMs },
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

  return transactionResult.alreadyDone ? { outcome: "already_there" } : { outcome: "resumed" };
}
