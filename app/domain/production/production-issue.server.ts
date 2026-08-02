import { ActorType, type ProductionIssueType, type Severity } from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  canBlockTask,
  canUnblockTask,
  deriveTaskWorkingStatus,
} from "~/domain/production/task-state-machine";
import { requiresQualityCheck } from "~/domain/production/quality-checklist";
import {
  recalculateOrderProductionSummary,
  recalculateProductionJobStatus,
} from "~/domain/production/recalculate.server";

const OPEN_ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "WAITING"] as const;

export interface CreateProductionIssueInput {
  shopId: string;
  productionJobId: string;
  productionTaskId: string | null;
  issueType: ProductionIssueType;
  severity: Severity;
  description: string;
  isBlocking: boolean;
  reworkQuantity: number | null;
  staffUserId: string;
}

export type CreateProductionIssueResult =
  { outcome: "created"; issueId: string } | { outcome: "rejected"; reason: string };

/**
 * Creating a blocking issue moves the task (only the task the issue is
 * scoped to — never a sibling task on the same job) into BLOCKED. Not
 * blocking simply records the issue without touching the task's status.
 */
export async function createProductionIssue(
  input: CreateProductionIssueInput,
): Promise<CreateProductionIssueResult> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) {
    return { outcome: "rejected", reason: "A description is required to report an issue." };
  }

  const job = await db.productionJob.findFirst({
    where: { id: input.productionJobId, shopId: input.shopId },
  });
  if (!job) {
    return { outcome: "rejected", reason: "Production job not found." };
  }

  let task = null;
  if (input.productionTaskId) {
    task = await db.productionTask.findFirst({
      where: { id: input.productionTaskId, productionJobId: input.productionJobId },
    });
    if (!task) {
      return { outcome: "rejected", reason: "Production task not found on this job." };
    }
    if (input.isBlocking) {
      const eligibility = canBlockTask(task.status);
      if (!eligibility.allowed) {
        return { outcome: "rejected", reason: eligibility.reason ?? "This task can't be blocked." };
      }
    }
  }

  const issueId = await db.$transaction(async (tx) => {
    const created = await tx.productionIssue.create({
      data: {
        shopId: input.shopId,
        orderId: job.orderId,
        productionJobId: job.id,
        productionTaskId: task?.id ?? null,
        proofGroupId: task?.proofGroupId ?? null,
        productionArtworkId: task?.productionArtworkId ?? null,
        issueType: input.issueType,
        severity: input.severity,
        description: trimmedDescription,
        isBlocking: input.isBlocking,
        reworkQuantity: input.reworkQuantity,
        createdByStaffId: input.staffUserId,
      },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: job.orderId,
        entityType: "ProductionIssue",
        entityId: created.id,
        eventType: "production_issue_created",
        summary: `Production issue reported${input.isBlocking ? " (blocking)" : ""}: ${trimmedDescription}`,
        metadata: {
          issueType: input.issueType,
          severity: input.severity,
          isBlocking: input.isBlocking,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    if (task && input.isBlocking) {
      await tx.productionTask.update({
        where: { id: task.id },
        data: { status: "BLOCKED", version: { increment: 1 } },
      });
      await tx.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: job.orderId,
          entityType: "ProductionTask",
          entityId: task.id,
          eventType: "production_task_blocked",
          summary: "Production task blocked by an unresolved issue",
          metadata: { issueId: created.id, previousStatus: task.status },
          actorStaffId: input.staffUserId,
          actorType: ActorType.STAFF,
        },
      });
      await recalculateProductionJobStatus(tx, { jobId: job.id, actorStaffId: input.staffUserId });
      await recalculateOrderProductionSummary(tx, {
        shopId: input.shopId,
        orderId: job.orderId,
        actorStaffId: input.staffUserId,
      });
    }

    // Only a blocking issue pages the assigned staff member — a
    // non-blocking issue is just a record, not something that needs their
    // attention now.
    if (input.isBlocking && job.assignedStaffId && job.assignedStaffId !== input.staffUserId) {
      await tx.notification.create({
        data: {
          staffUserId: job.assignedStaffId,
          type: "production_issue_blocking",
          title: "Blocking production issue reported",
          body: trimmedDescription,
          relatedEntityType: "ProductionJob",
          relatedEntityId: job.id,
        },
      });
    }

    return created.id;
  });

  return { outcome: "created", issueId };
}

export interface ResolveProductionIssueInput {
  shopId: string;
  productionIssueId: string;
  resolution: string;
  cancel: boolean;
  staffUserId: string;
}

export type ResolveProductionIssueResult =
  { outcome: "resolved" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function resolveProductionIssue(
  input: ResolveProductionIssueInput,
): Promise<ResolveProductionIssueResult> {
  const issue = await db.productionIssue.findFirst({
    where: { id: input.productionIssueId, shopId: input.shopId },
    include: { productionTask: true },
  });
  if (!issue) {
    return { outcome: "rejected", reason: "Production issue not found." };
  }
  if (issue.status === "RESOLVED" || issue.status === "CANCELLED") {
    return { outcome: "already_there" };
  }

  const trimmedResolution = input.resolution.trim();
  if (!input.cancel && !trimmedResolution) {
    return { outcome: "rejected", reason: "A resolution is required to resolve an issue." };
  }

  const nextStatus = input.cancel ? "CANCELLED" : "RESOLVED";

  await db.$transaction(async (tx) => {
    const updateResult = await tx.productionIssue.updateMany({
      where: { id: issue.id, status: { in: [...OPEN_ISSUE_STATUSES] } },
      data: {
        status: nextStatus,
        resolvedAt: new Date(),
        resolvedByStaffId: input.staffUserId,
        resolution: trimmedResolution || null,
      },
    });
    if (updateResult.count === 0) return;

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: issue.orderId,
        entityType: "ProductionIssue",
        entityId: issue.id,
        eventType: input.cancel ? "production_issue_cancelled" : "production_issue_resolved",
        summary: input.cancel
          ? "Production issue cancelled"
          : `Production issue resolved: ${trimmedResolution}`,
        metadata: { resolution: trimmedResolution || null },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    if (issue.isBlocking && issue.productionTaskId && issue.productionTask?.status === "BLOCKED") {
      const remainingBlockingIssues = await tx.productionIssue.count({
        where: {
          productionTaskId: issue.productionTaskId,
          isBlocking: true,
          status: { in: [...OPEN_ISSUE_STATUSES] },
          id: { not: issue.id },
        },
      });
      if (remainingBlockingIssues === 0) {
        const task = issue.productionTask;
        const eligibility = canUnblockTask(task.status);
        if (eligibility.allowed) {
          const nextTaskStatus = deriveTaskWorkingStatus({
            requiredQuantity: task.requiredQuantity,
            completedQuantity: task.completedQuantity,
            failedQuantity: task.failedQuantity,
            qualityApprovedQuantity: task.qualityApprovedQuantity,
            requiresQualityCheck: requiresQualityCheck(task.decorationMethod),
            hasPendingQualityCheckFailure: task.failedQuantity > 0,
          });
          await tx.productionTask.update({
            where: { id: task.id },
            data: { status: nextTaskStatus, version: { increment: 1 } },
          });
          await tx.activityEvent.create({
            data: {
              shopId: input.shopId,
              orderId: issue.orderId,
              entityType: "ProductionTask",
              entityId: task.id,
              eventType: "production_task_unblocked",
              summary: `Production task unblocked, returning to ${nextTaskStatus.toLowerCase().replace(/_/g, " ")}`,
              metadata: { newStatus: nextTaskStatus },
              actorStaffId: input.staffUserId,
              actorType: ActorType.STAFF,
            },
          });
        }
      }
    }

    await recalculateProductionJobStatus(tx, {
      jobId: issue.productionJobId,
      actorStaffId: input.staffUserId,
    });
    await recalculateOrderProductionSummary(tx, {
      shopId: input.shopId,
      orderId: issue.orderId,
      actorStaffId: input.staffUserId,
    });
  });

  return { outcome: "resolved" };
}
