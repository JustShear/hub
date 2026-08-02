import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface AssignProductionTaskInput {
  shopId: string;
  productionTaskId: string;
  /** null clears the assignment — supports "unassigned" work explicitly. */
  targetStaffUserId: string | null;
  expectedVersion: number;
  staffUserId: string;
}

export type AssignProductionTaskResult =
  | { outcome: "assigned"; staffUserId: string | null; staffUserName: string | null }
  | { outcome: "already_there"; staffUserId: string | null }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualVersion: number };

const STALE_EDIT_MESSAGE =
  "This task's assignment changed since you last saw it. Refresh to see the current value.";

// Task assignment is deliberately separate from the order's own ARTWORK/
// PRODUCTION assignment slots and from the proof group's own assignedStaffId
// — assigning a production task never touches either of those.
export async function assignProductionTask(
  input: AssignProductionTaskInput,
): Promise<AssignProductionTaskResult> {
  const task = await db.productionTask.findFirst({
    where: { id: input.productionTaskId, productionJob: { shopId: input.shopId } },
    include: { productionJob: { select: { orderId: true } } },
  });
  if (!task) {
    return { outcome: "rejected", reason: "Production task not found." };
  }
  if (task.status === "CANCELLED" || task.status === "COMPLETE" || task.status === "FAILED") {
    return { outcome: "rejected", reason: "This task has reached a terminal status." };
  }

  if (task.assignedStaffId === input.targetStaffUserId) {
    return { outcome: "already_there", staffUserId: task.assignedStaffId };
  }
  if (task.version !== input.expectedVersion) {
    return { outcome: "conflict", reason: STALE_EDIT_MESSAGE, actualVersion: task.version };
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

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.productionTask.updateMany({
      where: { id: input.productionTaskId, version: input.expectedVersion },
      data: { assignedStaffId: input.targetStaffUserId, version: { increment: 1 } },
    });
    if (updateResult.count === 0) {
      return { conflict: true as const };
    }

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: task.productionJob.orderId,
        entityType: "ProductionTask",
        entityId: task.id,
        eventType: "production_task_assigned",
        summary: "Production task assignment changed",
        metadata: {
          previousStaffUserId: task.assignedStaffId,
          newStaffUserId: input.targetStaffUserId,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return { conflict: false as const };
  });

  if (transactionResult.conflict) {
    const latest = await db.productionTask.findUnique({
      where: { id: input.productionTaskId },
      select: { version: true },
    });
    return {
      outcome: "conflict",
      reason: STALE_EDIT_MESSAGE,
      actualVersion: latest?.version ?? input.expectedVersion,
    };
  }

  return {
    outcome: "assigned",
    staffUserId: input.targetStaffUserId,
    staffUserName: targetStaffName,
  };
}

export interface AssignProductionJobInput {
  shopId: string;
  productionJobId: string;
  targetStaffUserId: string | null;
  assignedTeam: string | null;
  expectedVersion: number;
  staffUserId: string;
}

export type AssignProductionJobResult =
  | { outcome: "assigned" }
  | { outcome: "already_there" }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualVersion: number };

/** Job-level assignment — a simple department/owner label, distinct from any individual task's own assignee. */
export async function assignProductionJob(
  input: AssignProductionJobInput,
): Promise<AssignProductionJobResult> {
  const job = await db.productionJob.findFirst({
    where: { id: input.productionJobId, shopId: input.shopId },
  });
  if (!job) {
    return { outcome: "rejected", reason: "Production job not found." };
  }
  if (job.status === "CANCELLED" || job.status === "COMPLETE") {
    return { outcome: "rejected", reason: "This job has reached a terminal status." };
  }

  if (job.assignedStaffId === input.targetStaffUserId && job.assignedTeam === input.assignedTeam) {
    return { outcome: "already_there" };
  }
  if (job.version !== input.expectedVersion) {
    return { outcome: "conflict", reason: STALE_EDIT_MESSAGE, actualVersion: job.version };
  }

  if (input.targetStaffUserId) {
    const targetStaff = await db.staffUser.findFirst({
      where: { id: input.targetStaffUserId, shopId: input.shopId, isActive: true },
    });
    if (!targetStaff) {
      return { outcome: "rejected", reason: "That staff member is not active or doesn't exist." };
    }
  }

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.productionJob.updateMany({
      where: { id: input.productionJobId, version: input.expectedVersion },
      data: {
        assignedStaffId: input.targetStaffUserId,
        assignedTeam: input.assignedTeam,
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) {
      return { conflict: true as const };
    }
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: job.orderId,
        entityType: "ProductionJob",
        entityId: job.id,
        eventType: "production_job_assigned",
        summary: `Production job ${job.jobNumber} assignment changed`,
        metadata: {
          previousStaffUserId: job.assignedStaffId,
          newStaffUserId: input.targetStaffUserId,
          assignedTeam: input.assignedTeam,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return { conflict: false as const };
  });

  if (transactionResult.conflict) {
    const latest = await db.productionJob.findUnique({
      where: { id: input.productionJobId },
      select: { version: true },
    });
    return {
      outcome: "conflict",
      reason: STALE_EDIT_MESSAGE,
      actualVersion: latest?.version ?? input.expectedVersion,
    };
  }
  return { outcome: "assigned" };
}
