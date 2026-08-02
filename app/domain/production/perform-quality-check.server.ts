import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { validateQualityCheckQuantities } from "~/domain/production/quantity-validation";
import {
  recalculateOrderProductionSummary,
  recalculateProductionJobStatus,
} from "~/domain/production/recalculate.server";

export interface PerformQualityCheckInput {
  shopId: string;
  productionTaskId: string;
  checkedQuantity: number;
  approvedQuantity: number;
  failedQuantity: number;
  checklistResult: Record<string, boolean> | null;
  notes: string | null;
  failureReason: string | null;
  staffUserId: string;
}

export type PerformQualityCheckResult =
  { outcome: "recorded"; qualityCheckId: string } | { outcome: "rejected"; reason: string };

/**
 * Records one quality-check attempt (append-only — never edited or
 * deleted). A failure moves that many units from the task's completed
 * quantity into its failed quantity (available for rework via
 * record-production-quantity.server.ts's reworkedQuantity path) — it never
 * silently reduces the task's required quantity, and never marks the task
 * complete.
 */
export async function performQualityCheck(
  input: PerformQualityCheckInput,
): Promise<PerformQualityCheckResult> {
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

  const validation = validateQualityCheckQuantities({
    currentCompletedQuantity: task.completedQuantity,
    currentQualityApprovedQuantity: task.qualityApprovedQuantity,
    checkedQuantity: input.checkedQuantity,
    approvedQuantity: input.approvedQuantity,
    failedQuantity: input.failedQuantity,
  });
  if (!validation.valid) {
    return {
      outcome: "rejected",
      reason: validation.reason ?? "Invalid quality-check quantities.",
    };
  }

  const reworkRequired = input.failedQuantity > 0;
  const trimmedFailureReason = input.failureReason?.trim() ?? "";

  const qualityCheckId = await db.$transaction(async (tx) => {
    const created = await tx.productionQualityCheck.create({
      data: {
        productionTaskId: task.id,
        checkedQuantity: input.checkedQuantity,
        approvedQuantity: input.approvedQuantity,
        failedQuantity: input.failedQuantity,
        checklistResult: input.checklistResult ?? undefined,
        notes: input.notes,
        failureReason: input.failureReason,
        reworkRequired,
        checkedByStaffId: input.staffUserId,
      },
    });

    const nextCompleted = task.completedQuantity - input.failedQuantity;
    const nextFailed = task.failedQuantity + input.failedQuantity;
    const nextQualityApproved = task.qualityApprovedQuantity + input.approvedQuantity;

    // A batch that fully passed and covers every remaining unchecked unit
    // moves the task on from AWAITING_QUALITY_CHECK; a partial or failing
    // check leaves it there (or moves it back into rework) rather than
    // advancing it.
    const stillAwaitingCheck = nextQualityApproved < nextCompleted;
    const nextStatus =
      task.status === "AWAITING_QUALITY_CHECK" && !stillAwaitingCheck && reworkRequired
        ? "PARTIALLY_COMPLETE"
        : task.status;

    await tx.productionTask.update({
      where: { id: task.id },
      data: {
        completedQuantity: nextCompleted,
        failedQuantity: nextFailed,
        qualityApprovedQuantity: nextQualityApproved,
        status: nextStatus,
        version: { increment: 1 },
      },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: task.productionJob.orderId,
        entityType: "ProductionTask",
        entityId: task.id,
        eventType: "production_quality_check_recorded",
        summary: reworkRequired
          ? `Quality check: ${input.approvedQuantity} approved, ${input.failedQuantity} failed — rework required`
          : `Quality check: ${input.approvedQuantity} approved`,
        metadata: {
          qualityCheckId: created.id,
          checkedQuantity: input.checkedQuantity,
          approvedQuantity: input.approvedQuantity,
          failedQuantity: input.failedQuantity,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    if (reworkRequired) {
      await tx.productionIssue.create({
        data: {
          shopId: input.shopId,
          orderId: task.productionJob.orderId,
          productionJobId: task.productionJobId,
          productionTaskId: task.id,
          proofGroupId: task.proofGroupId,
          productionArtworkId: task.productionArtworkId,
          issueType: "QUANTITY_DISCREPANCY",
          severity: "MEDIUM",
          description:
            trimmedFailureReason.length > 0
              ? trimmedFailureReason
              : `${input.failedQuantity} unit(s) failed quality check and require rework.`,
          isBlocking: false,
          reworkQuantity: input.failedQuantity,
          createdByStaffId: input.staffUserId,
        },
      });
    }

    await recalculateProductionJobStatus(tx, {
      jobId: task.productionJobId,
      actorStaffId: input.staffUserId,
    });
    await recalculateOrderProductionSummary(tx, {
      shopId: input.shopId,
      orderId: task.productionJob.orderId,
      actorStaffId: input.staffUserId,
    });

    return created.id;
  });

  return { outcome: "recorded", qualityCheckId };
}
