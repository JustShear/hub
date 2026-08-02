import { ActorType, type DecorationMethod } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";
import { recalculateOrderProductionSummary } from "~/domain/production/recalculate.server";

const MAX_JOB_NUMBER_ATTEMPTS = 5;

export interface CreateProductionJobsFromExportBatchInput {
  shopId: string;
  exportBatchId: string;
  staffUserId: string;
}

export interface CreateProductionJobsFromExportBatchResult {
  outcome: "created" | "already_exists" | "rejected";
  reason?: string;
  createdJobIds: string[];
  createdTaskIds: string[];
}

/**
 * The one place production jobs/tasks are created — always from an
 * EXPORTED batch, never from "whatever the proof group's latest artwork
 * is now." Idempotent at both levels: @@unique([exportBatchId,
 * decorationMethod]) on ProductionJob and @@unique([exportBatchItemId]) on
 * ProductionTask mean calling this twice for the same batch (the automatic
 * call right after export, and a later manual retry for recovery) never
 * creates duplicates — it just returns "already_exists" once every item
 * already has a task.
 */
export async function createProductionJobsFromExportBatch(
  input: CreateProductionJobsFromExportBatchInput,
): Promise<CreateProductionJobsFromExportBatchResult> {
  const batch = await db.exportBatch.findFirst({
    where: { id: input.exportBatchId, shopId: input.shopId },
    include: {
      items: {
        include: {
          productionTask: { select: { id: true } },
          productionArtwork: {
            include: { orderLineAllocations: true },
          },
          proofGroup: { select: { name: true } },
        },
      },
    },
  });
  if (!batch) {
    return {
      outcome: "rejected",
      reason: "Export batch not found.",
      createdJobIds: [],
      createdTaskIds: [],
    };
  }
  if (batch.status !== "EXPORTED") {
    return {
      outcome: "rejected",
      reason: "Production jobs can only be created from a successfully exported batch.",
      createdJobIds: [],
      createdTaskIds: [],
    };
  }

  const pendingItems = batch.items.filter((item) => !item.productionTask);
  if (pendingItems.length === 0) {
    return { outcome: "already_exists", createdJobIds: [], createdTaskIds: [] };
  }

  const createdJobIds: string[] = [];
  const createdTaskIds: string[] = [];

  // One item at a time — each item's job-find-or-create and task-create
  // both have their own unique-constraint-based idempotency guard, so
  // processing sequentially (rather than one giant transaction) means a
  // failure partway through still leaves every already-created row intact
  // and safely re-runnable.
  for (const item of pendingItems) {
    const requiredQuantity = item.productionArtwork.orderLineAllocations.reduce(
      (sum, allocation) => sum + allocation.quantity,
      0,
    );
    if (requiredQuantity <= 0) {
      // No order-line allocation recorded for this artwork revision — there's
      // nothing to produce a quantity against. Skip rather than fabricate a
      // required quantity of zero, which would make every completion
      // trivially satisfied.
      continue;
    }

    const job = await findOrCreateProductionJob({
      shopId: input.shopId,
      orderId: batch.orderId,
      exportBatchId: batch.id,
      decorationMethod: item.decorationMethodSnapshot,
      staffUserId: input.staffUserId,
    });
    if (job.created) createdJobIds.push(job.id);

    const task = await createProductionTaskForItem({
      shopId: input.shopId,
      orderId: batch.orderId,
      jobId: job.id,
      jobNumber: job.jobNumber,
      exportBatchItemId: item.id,
      proofGroupId: item.proofGroupId,
      proofGroupName: item.proofGroup.name,
      productionArtworkId: item.productionArtworkId,
      decorationMethod: item.decorationMethodSnapshot,
      placement: item.placementSnapshot,
      requiredQuantity,
      staffUserId: input.staffUserId,
    });
    if (task) createdTaskIds.push(task);
  }

  if (createdTaskIds.length === 0) {
    return { outcome: "already_exists", createdJobIds, createdTaskIds };
  }

  await db.$transaction(async (tx) => {
    await recalculateOrderProductionSummary(tx, {
      shopId: input.shopId,
      orderId: batch.orderId,
      actorStaffId: input.staffUserId,
    });
  });

  return { outcome: "created", createdJobIds, createdTaskIds };
}

interface FindOrCreateJobParams {
  shopId: string;
  orderId: string;
  exportBatchId: string;
  decorationMethod: DecorationMethod;
  staffUserId: string;
}

async function findOrCreateProductionJob(
  params: FindOrCreateJobParams,
): Promise<{ id: string; jobNumber: number; created: boolean }> {
  const existing = await db.productionJob.findUnique({
    where: {
      exportBatchId_decorationMethod: {
        exportBatchId: params.exportBatchId,
        decorationMethod: params.decorationMethod,
      },
    },
  });
  if (existing) {
    return { id: existing.id, jobNumber: existing.jobNumber, created: false };
  }

  for (let attempt = 0; attempt < MAX_JOB_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const latest = await tx.productionJob.findFirst({
          where: { orderId: params.orderId },
          orderBy: { jobNumber: "desc" },
        });
        const nextJobNumber = (latest?.jobNumber ?? 0) + 1;

        const created = await tx.productionJob.create({
          data: {
            shopId: params.shopId,
            orderId: params.orderId,
            exportBatchId: params.exportBatchId,
            jobNumber: nextJobNumber,
            decorationMethod: params.decorationMethod,
            createdByStaffId: params.staffUserId,
          },
        });

        await tx.activityEvent.create({
          data: {
            shopId: params.shopId,
            orderId: params.orderId,
            entityType: "ProductionJob",
            entityId: created.id,
            eventType: "production_job_created",
            summary: `Production job ${nextJobNumber} created from export batch`,
            metadata: {
              exportBatchId: params.exportBatchId,
              decorationMethod: params.decorationMethod,
            },
            actorStaffId: params.staffUserId,
            actorType: ActorType.STAFF,
          },
        });

        return { id: created.id, jobNumber: created.jobNumber, created: true };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // Either a concurrent request already created this exact job, or
        // the jobNumber collided — re-fetch by the real idempotency key
        // (exportBatchId + decorationMethod) rather than blindly retrying,
        // since the former case isn't solved by retrying at all.
        const raced = await db.productionJob.findUnique({
          where: {
            exportBatchId_decorationMethod: {
              exportBatchId: params.exportBatchId,
              decorationMethod: params.decorationMethod,
            },
          },
        });
        if (raced) {
          return { id: raced.id, jobNumber: raced.jobNumber, created: false };
        }
        if (attempt < MAX_JOB_NUMBER_ATTEMPTS - 1) continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to allocate a production job number after multiple attempts.");
}

interface CreateTaskParams {
  shopId: string;
  orderId: string;
  jobId: string;
  jobNumber: number;
  exportBatchItemId: string;
  proofGroupId: string;
  proofGroupName: string;
  productionArtworkId: string;
  decorationMethod: DecorationMethod;
  placement: string | null;
  requiredQuantity: number;
  staffUserId: string;
}

async function createProductionTaskForItem(params: CreateTaskParams): Promise<string | null> {
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.productionTask.create({
        data: {
          productionJobId: params.jobId,
          proofGroupId: params.proofGroupId,
          exportBatchItemId: params.exportBatchItemId,
          productionArtworkId: params.productionArtworkId,
          decorationMethod: params.decorationMethod,
          placement: params.placement,
          requiredQuantity: params.requiredQuantity,
        },
      });

      await tx.activityEvent.create({
        data: {
          shopId: params.shopId,
          orderId: params.orderId,
          entityType: "ProductionTask",
          entityId: created.id,
          eventType: "production_task_created",
          summary: `Production task created for "${params.proofGroupName}" on job ${params.jobNumber}`,
          metadata: {
            productionArtworkId: params.productionArtworkId,
            requiredQuantity: params.requiredQuantity,
          },
          actorStaffId: params.staffUserId,
          actorType: ActorType.STAFF,
        },
      });

      return created.id;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      // A concurrent call already created the task for this exact export
      // batch item — exactly the idempotency guarantee this function
      // promises, not an error.
      return null;
    }
    throw error;
  }
}
