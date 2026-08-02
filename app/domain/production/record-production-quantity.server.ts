import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";
import { validateQuantityUpdate } from "~/domain/production/quantity-validation";
import {
  recalculateOrderProductionSummary,
  recalculateProductionJobStatus,
} from "~/domain/production/recalculate.server";

export interface RecordProductionQuantityInput {
  shopId: string;
  productionTaskId: string;
  newlyProducedQuantity: number;
  newlyFailedQuantity: number;
  reworkedQuantity: number;
  overrideReason: string | null;
  idempotencyKey: string;
  staffUserId: string;
}

export type RecordProductionQuantityResult =
  | { outcome: "recorded"; completedQuantity: number; failedQuantity: number }
  | { outcome: "duplicate"; completedQuantity: number; failedQuantity: number }
  | { outcome: "rejected"; reason: string };

/**
 * The one place production quantities are recorded. The @@unique constraint
 * on ProductionQuantityUpdate(productionTaskId, idempotencyKey) is the real
 * duplicate-submission guard — a retried request with the same key can
 * never increment the task's quantities twice.
 */
export async function recordProductionQuantity(
  input: RecordProductionQuantityInput,
): Promise<RecordProductionQuantityResult> {
  const existing = await db.productionQuantityUpdate.findUnique({
    where: {
      productionTaskId_idempotencyKey: {
        productionTaskId: input.productionTaskId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    const task = await db.productionTask.findUniqueOrThrow({
      where: { id: input.productionTaskId },
      select: { completedQuantity: true, failedQuantity: true },
    });
    return {
      outcome: "duplicate",
      completedQuantity: task.completedQuantity,
      failedQuantity: task.failedQuantity,
    };
  }

  const task = await db.productionTask.findFirst({
    where: { id: input.productionTaskId, productionJob: { shopId: input.shopId } },
    include: { productionJob: { select: { id: true, orderId: true } } },
  });
  if (!task) {
    return { outcome: "rejected", reason: "Production task not found." };
  }
  if (task.status === "CANCELLED" || task.status === "COMPLETE" || task.status === "FAILED") {
    return { outcome: "rejected", reason: "This task has reached a terminal status." };
  }

  const validation = validateQuantityUpdate({
    requiredQuantity: task.requiredQuantity,
    currentCompletedQuantity: task.completedQuantity,
    currentFailedQuantity: task.failedQuantity,
    newlyProducedQuantity: input.newlyProducedQuantity,
    newlyFailedQuantity: input.newlyFailedQuantity,
    reworkedQuantity: input.reworkedQuantity,
    hasQuantityOverride: Boolean(input.overrideReason?.trim()),
  });
  if (
    !validation.valid ||
    validation.nextCompletedQuantity === undefined ||
    validation.nextFailedQuantity === undefined
  ) {
    return { outcome: "rejected", reason: validation.reason ?? "Invalid quantity update." };
  }

  const trimmedInputReason = input.overrideReason?.trim() ?? "";
  const trimmedOverrideReason = trimmedInputReason.length > 0 ? trimmedInputReason : null;
  const isOverride = trimmedOverrideReason !== null;
  const nextCompleted = validation.nextCompletedQuantity;
  const nextFailed = validation.nextFailedQuantity;

  try {
    const result = await db.$transaction(async (tx) => {
      await tx.productionQuantityUpdate.create({
        data: {
          productionTaskId: task.id,
          idempotencyKey: input.idempotencyKey,
          newlyProducedQuantity: input.newlyProducedQuantity,
          newlyFailedQuantity: input.newlyFailedQuantity,
          reworkedQuantity: input.reworkedQuantity,
          isOverride,
          overrideReason: trimmedOverrideReason,
          staffUserId: input.staffUserId,
        },
      });

      const nextReworkTotal = task.reworkQuantity + input.reworkedQuantity;

      const attempted = nextCompleted + nextFailed;
      const nextStatus =
        attempted >= task.requiredQuantity
          ? task.status === "PARTIALLY_COMPLETE" || task.status === "IN_PROGRESS"
            ? "AWAITING_QUALITY_CHECK"
            : task.status
          : task.status === "IN_PROGRESS"
            ? "PARTIALLY_COMPLETE"
            : task.status;

      await tx.productionTask.update({
        where: { id: task.id },
        data: {
          completedQuantity: nextCompleted,
          failedQuantity: nextFailed,
          reworkQuantity: nextReworkTotal,
          status: nextStatus,
          version: { increment: 1 },
        },
      });

      if (isOverride && trimmedOverrideReason) {
        await tx.manualOverride.create({
          data: {
            shopId: input.shopId,
            overrideType: "OVERRIDE_PRODUCTION_QUANTITY",
            relatedEntityType: "ProductionTask",
            relatedEntityId: task.id,
            previousValue: {
              completedQuantity: task.completedQuantity,
              failedQuantity: task.failedQuantity,
            },
            newValue: { completedQuantity: nextCompleted, failedQuantity: nextFailed },
            reason: trimmedOverrideReason,
            staffUserId: input.staffUserId,
          },
        });
      }

      await tx.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: task.productionJob.orderId,
          entityType: "ProductionTask",
          entityId: task.id,
          eventType: "production_quantity_recorded",
          summary: `Production quantity recorded: +${input.newlyProducedQuantity} produced, +${input.newlyFailedQuantity} failed, ${input.reworkedQuantity} reworked`,
          metadata: {
            newlyProducedQuantity: input.newlyProducedQuantity,
            newlyFailedQuantity: input.newlyFailedQuantity,
            reworkedQuantity: input.reworkedQuantity,
            completedQuantity: nextCompleted,
            failedQuantity: nextFailed,
            isOverride,
          },
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

      return { completedQuantity: nextCompleted, failedQuantity: nextFailed };
    });

    return { outcome: "recorded", ...result };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      // A genuinely concurrent retry of THIS SAME submission raced past the
      // pre-check above — the unique constraint is the real guard.
      const task2 = await db.productionTask.findUniqueOrThrow({
        where: { id: input.productionTaskId },
        select: { completedQuantity: true, failedQuantity: true },
      });
      return {
        outcome: "duplicate",
        completedQuantity: task2.completedQuantity,
        failedQuantity: task2.failedQuantity,
      };
    }
    throw error;
  }
}
