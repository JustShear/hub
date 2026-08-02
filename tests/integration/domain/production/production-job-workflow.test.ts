import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProductionArtwork } from "~/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "~/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "~/domain/production/mark-production-artwork-ready.server";
import { createExportBatch } from "~/domain/production/create-export-batch.server";
import { createProductionJobsFromExportBatch } from "~/domain/production/create-production-jobs.server";
import { assignProductionTask } from "~/domain/production/assign-production-task.server";
import {
  pauseProductionTask,
  resumeProductionTask,
  startProductionTask,
} from "~/domain/production/task-lifecycle.server";
import { recordProductionQuantity } from "~/domain/production/record-production-quantity.server";
import { performQualityCheck } from "~/domain/production/perform-quality-check.server";
import {
  createProductionIssue,
  resolveProductionIssue,
} from "~/domain/production/production-issue.server";
import { completeProductionTask } from "~/domain/production/complete-production-task.server";
import { reopenProductionTask } from "~/domain/production/reopen-production-task.server";
import { createProductionTestTracker, PDF_BYTES } from "./helpers";

/**
 * Builds a real order -> approved-free proof group -> production artwork ->
 * export batch chain (mirroring create-export-batch.test.ts's own
 * seedReadyToExportGroup), then returns the ProductionJob/ProductionTask
 * that createExportBatch auto-creates as its own follow-up — the same real
 * pipeline every M11 UI action runs through, not a shortcut fixture.
 */
async function seedExportedTask(
  tracker: ReturnType<typeof createProductionTestTracker>,
  quantity = 10,
) {
  const order = await tracker.createOrder();
  const staffUser = await tracker.createStaffUser();
  const line = await tracker.createOrderLine(order.id, quantity);
  const proofGroupId = await tracker.createNoProofRequiredGroup({
    orderId: order.id,
    shopId: order.shopId,
    staffUserId: staffUser.id,
    orderLineId: line.id,
  });
  const artwork = await createProductionArtwork({
    shopId: order.shopId,
    proofGroupId,
    fileBuffer: PDF_BYTES,
    originalFilename: "artwork.pdf",
    decorationMethod: null,
    placement: "Front badge",
    productionMetadata: null,
    staffUserId: staffUser.id,
    idempotencyKey: null,
  });
  if (artwork.outcome !== "created") throw new Error("setup failed: production artwork");
  const allocation = await setProductionArtworkOrderLines({
    shopId: order.shopId,
    productionArtworkId: artwork.productionArtworkId,
    allocations: [{ orderLineId: line.id, quantity }],
    staffUserId: staffUser.id,
  });
  if (allocation.outcome !== "set") throw new Error("setup failed: allocation");
  const ready = await markProductionArtworkReady({
    shopId: order.shopId,
    productionArtworkId: artwork.productionArtworkId,
    staffUserId: staffUser.id,
  });
  if (ready.outcome !== "ready") throw new Error("setup failed: mark ready");

  const exportResult = await createExportBatch({
    shopId: order.shopId,
    orderId: order.id,
    proofGroupIds: [proofGroupId],
    destination: null,
    staffUserId: staffUser.id,
    idempotencyKey: randomUUID(),
  });
  if (exportResult.outcome !== "exported") throw new Error("setup failed: export");

  const task = await db.productionTask.findFirstOrThrow({
    where: { productionJob: { exportBatchId: exportResult.exportBatchId } },
  });
  const job = await db.productionJob.findUniqueOrThrow({ where: { id: task.productionJobId } });

  return {
    order,
    staffUser,
    line,
    proofGroupId,
    artworkId: artwork.productionArtworkId,
    exportBatchId: exportResult.exportBatchId,
    job,
    task,
  };
}

describe("createProductionJobsFromExportBatch (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("creates exactly one job and task per export batch item, referencing the exact artwork and export batch item", async () => {
    const { order, artworkId, exportBatchId, job, task, line } = await seedExportedTask(tracker);

    expect(job.exportBatchId).toBe(exportBatchId);
    expect(job.orderId).toBe(order.id);
    expect(task.productionArtworkId).toBe(artworkId);
    expect(task.requiredQuantity).toBe(line.quantity);

    const item = await db.exportBatchItem.findFirstOrThrow({ where: { exportBatchId } });
    expect(task.exportBatchItemId).toBe(item.id);
  });

  it("is idempotent: calling it again for the same already-processed batch creates no duplicate rows", async () => {
    const { order, exportBatchId, staffUser } = await seedExportedTask(tracker);

    const result = await createProductionJobsFromExportBatch({
      shopId: order.shopId,
      exportBatchId,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("already_exists");
    expect(result.createdJobIds).toEqual([]);
    expect(await db.productionJob.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.productionTask.count({ where: { productionJob: { orderId: order.id } } })).toBe(
      1,
    );
  });

  it("rejects when the export batch doesn't exist", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const result = await createProductionJobsFromExportBatch({
      shopId: order.shopId,
      exportBatchId: "not-a-real-batch-id",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("advances the order's productionSummary to QUEUED once a job/task is created", async () => {
    const { order } = await seedExportedTask(tracker);
    const refreshed = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.productionSummary).toBe("QUEUED");
  });
});

describe("assignProductionTask (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("assigns an active staff member and records the change", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker);
    const targetStaff = await tracker.createStaffUser();

    const result = await assignProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      targetStaffUserId: targetStaff.id,
      expectedVersion: task.version,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("assigned");
    const refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshed.assignedStaffId).toBe(targetStaff.id);
    expect(refreshed.version).toBe(task.version + 1);
  });

  it("rejects assigning a staff member who isn't active", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker);
    const inactiveStaff = await tracker.createStaffUser();
    await db.staffUser.update({ where: { id: inactiveStaff.id }, data: { isActive: false } });

    const result = await assignProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      targetStaffUserId: inactiveStaff.id,
      expectedVersion: task.version,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("detects a stale version and reports the real current version", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker);

    const result = await assignProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      targetStaffUserId: staffUser.id,
      expectedVersion: task.version + 5,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("conflict");
    if (result.outcome === "conflict") {
      expect(result.actualVersion).toBe(task.version);
    }
  });
});

describe("Production task start/pause/resume lifecycle (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("starts a queued task and derives IN_PROGRESS at the job level too", async () => {
    const { order, staffUser, task, job } = await seedExportedTask(tracker);

    const result = await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("started");
    const refreshedTask = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshedTask.status).toBe("IN_PROGRESS");
    expect(refreshedTask.startedAt).not.toBeNull();
    const refreshedJob = await db.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshedJob.status).toBe("IN_PROGRESS");
  });

  it("starting an already in-progress task is idempotent and doesn't duplicate the start activity event", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker);
    await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    const second = await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    expect(second.outcome).toBe("already_there");
    expect(
      await db.activityEvent.count({
        where: {
          entityType: "ProductionTask",
          entityId: task.id,
          eventType: "production_task_started",
        },
      }),
    ).toBe(1);
  });

  it("prevents starting a task that has an open blocking issue", async () => {
    const { order, staffUser, task, job } = await seedExportedTask(tracker);
    await createProductionIssue({
      shopId: order.shopId,
      productionJobId: job.id,
      productionTaskId: task.id,
      issueType: "EQUIPMENT_ISSUE",
      severity: "HIGH",
      description: "Press is broken.",
      isBlocking: true,
      reworkQuantity: null,
      staffUserId: staffUser.id,
    });

    const result = await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
    const refreshedTask = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshedTask.status).toBe("BLOCKED");
  });

  it("requires a valid pause reason, and pause/resume round-trips the task back to IN_PROGRESS", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker);
    await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    const invalidReason = await pauseProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      reasonCode: "NOT_A_REAL_REASON",
      otherText: null,
      staffUserId: staffUser.id,
    });
    expect(invalidReason.outcome).toBe("rejected");

    const paused = await pauseProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      reasonCode: "WAITING_FOR_STOCK",
      otherText: null,
      staffUserId: staffUser.id,
    });
    expect(paused.outcome).toBe("paused");
    let refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshed.status).toBe("PAUSED");
    expect(refreshed.pauseReason).toBe("Waiting for stock");

    const resumed = await resumeProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });
    expect(resumed.outcome).toBe("resumed");
    refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshed.status).toBe("IN_PROGRESS");
    expect(refreshed.pausedAt).toBeNull();
  });
});

describe("Production issues block and unblock tasks (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("a blocking issue moves the task and job to BLOCKED and the order to BLOCKED", async () => {
    const { order, staffUser, task, job } = await seedExportedTask(tracker);

    const issue = await createProductionIssue({
      shopId: order.shopId,
      productionJobId: job.id,
      productionTaskId: task.id,
      issueType: "STOCK_SHORTAGE",
      severity: "HIGH",
      description: "Out of blank garments.",
      isBlocking: true,
      reworkQuantity: null,
      staffUserId: staffUser.id,
    });
    expect(issue.outcome).toBe("created");

    expect((await db.productionTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      "BLOCKED",
    );
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "BLOCKED",
    );
    expect(
      (await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } })).productionSummary,
    ).toBe("BLOCKED");
  });

  it("a non-blocking issue never changes the task's status", async () => {
    const { order, staffUser, task, job } = await seedExportedTask(tracker);

    await createProductionIssue({
      shopId: order.shopId,
      productionJobId: job.id,
      productionTaskId: task.id,
      issueType: "ARTWORK_PROBLEM",
      severity: "LOW",
      description: "Minor colour drift noted for future reference.",
      isBlocking: false,
      reworkQuantity: null,
      staffUserId: staffUser.id,
    });

    expect((await db.productionTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      task.status,
    );
  });

  it("resolving the blocking issue returns the task to its derived working status and unblocks the job", async () => {
    const { order, staffUser, task, job } = await seedExportedTask(tracker);
    const issue = await createProductionIssue({
      shopId: order.shopId,
      productionJobId: job.id,
      productionTaskId: task.id,
      issueType: "EQUIPMENT_ISSUE",
      severity: "HIGH",
      description: "Press is broken.",
      isBlocking: true,
      reworkQuantity: null,
      staffUserId: staffUser.id,
    });
    if (issue.outcome !== "created") throw new Error("setup failed");

    const resolved = await resolveProductionIssue({
      shopId: order.shopId,
      productionIssueId: issue.issueId,
      resolution: "Technician fixed the press.",
      cancel: false,
      staffUserId: staffUser.id,
    });
    expect(resolved.outcome).toBe("resolved");

    const refreshedTask = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshedTask.status).toBe("QUEUED");
    const refreshedJob = await db.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshedJob.status).toBe("QUEUED");
    const refreshedIssue = await db.productionIssue.findUniqueOrThrow({
      where: { id: issue.issueId },
    });
    expect(refreshedIssue.status).toBe("RESOLVED");
  });

  it("resolving a blocking issue never touches an unrelated sibling task's status", async () => {
    const seeded1 = await seedExportedTask(tracker);
    // A second, entirely independent job/task on a different order.
    const seeded2 = await seedExportedTask(tracker);

    const issue = await createProductionIssue({
      shopId: seeded1.order.shopId,
      productionJobId: seeded1.job.id,
      productionTaskId: seeded1.task.id,
      issueType: "EQUIPMENT_ISSUE",
      severity: "HIGH",
      description: "Press is broken.",
      isBlocking: true,
      reworkQuantity: null,
      staffUserId: seeded1.staffUser.id,
    });
    if (issue.outcome !== "created") throw new Error("setup failed");

    await resolveProductionIssue({
      shopId: seeded1.order.shopId,
      productionIssueId: issue.issueId,
      resolution: "Fixed.",
      cancel: false,
      staffUserId: seeded1.staffUser.id,
    });

    const unrelatedTask = await db.productionTask.findUniqueOrThrow({
      where: { id: seeded2.task.id },
    });
    expect(unrelatedTask.status).toBe(seeded2.task.status);
  });
});

describe("Recording production quantities (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("accumulates partial quantities and moves the task to PARTIALLY_COMPLETE once started", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker, 10);
    await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    const result = await recordProductionQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: 4,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("recorded");
    if (result.outcome === "recorded") {
      expect(result.completedQuantity).toBe(4);
    }
    const refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshed.status).toBe("PARTIALLY_COMPLETE");
  });

  it("moves the task to AWAITING_QUALITY_CHECK once the full required quantity is attempted", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker, 10);
    await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    await recordProductionQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: 10,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    const refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshed.status).toBe("AWAITING_QUALITY_CHECK");
    expect(refreshed.completedQuantity).toBe(10);
  });

  it("rejects exceeding the required quantity without a documented override", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker, 10);
    await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    const result = await recordProductionQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: 11,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("allows exceeding the required quantity with a documented override and records a ManualOverride", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker, 10);
    await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    const result = await recordProductionQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: 11,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: "Customer requested one extra as a spare.",
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("recorded");
    const override = await db.manualOverride.findFirst({
      where: { overrideType: "OVERRIDE_PRODUCTION_QUANTITY", relatedEntityId: task.id },
    });
    expect(override).not.toBeNull();
  });

  it("a duplicate submission with the same idempotency key never double-counts", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker, 10);
    await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });
    const idempotencyKey = randomUUID();

    const first = await recordProductionQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: 5,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey,
      staffUserId: staffUser.id,
    });
    const second = await recordProductionQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: 5,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey,
      staffUserId: staffUser.id,
    });

    expect(first.outcome).toBe("recorded");
    expect(second.outcome).toBe("duplicate");
    const refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshed.completedQuantity).toBe(5);
  });
});

describe("Quality checks and rework (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("a passing quality check approves the produced quantity without altering it", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker, 10);
    await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });
    await recordProductionQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: 10,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    const result = await performQualityCheck({
      shopId: order.shopId,
      productionTaskId: task.id,
      checkedQuantity: 10,
      approvedQuantity: 10,
      failedQuantity: 0,
      checklistResult: { correct_artwork: true },
      notes: null,
      failureReason: null,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("recorded");
    const refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshed.completedQuantity).toBe(10);
    expect(refreshed.qualityApprovedQuantity).toBe(10);
    expect(refreshed.failedQuantity).toBe(0);
  });

  it("a failing quality check moves units into failed, creates a rework issue, and preserves the failed check permanently", async () => {
    const { order, staffUser, task } = await seedExportedTask(tracker, 10);
    await startProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });
    await recordProductionQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: 10,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    const result = await performQualityCheck({
      shopId: order.shopId,
      productionTaskId: task.id,
      checkedQuantity: 10,
      approvedQuantity: 8,
      failedQuantity: 2,
      checklistResult: { correct_artwork: false },
      notes: "Two units misprinted.",
      failureReason: "Misprint",
      staffUserId: staffUser.id,
    });
    expect(result.outcome).toBe("recorded");

    let refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshed.completedQuantity).toBe(8);
    expect(refreshed.failedQuantity).toBe(2);
    expect(refreshed.status).toBe("PARTIALLY_COMPLETE");

    const reworkIssue = await db.productionIssue.findFirst({
      where: { productionTaskId: task.id, issueType: "QUANTITY_DISCREPANCY" },
    });
    expect(reworkIssue).not.toBeNull();
    expect(reworkIssue?.reworkQuantity).toBe(2);

    // The failed check itself is never edited or deleted — successfully
    // reworking the units afterwards must not erase this history.
    if (result.outcome === "recorded") {
      const preservedCheck = await db.productionQualityCheck.findUniqueOrThrow({
        where: { id: result.qualityCheckId },
      });
      expect(preservedCheck.failedQuantity).toBe(2);
    }

    const reworked = await recordProductionQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: 0,
      newlyFailedQuantity: 0,
      reworkedQuantity: 2,
      overrideReason: null,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });
    expect(reworked.outcome).toBe("recorded");

    refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshed.completedQuantity).toBe(10);
    expect(refreshed.failedQuantity).toBe(0);
    expect(refreshed.reworkQuantity).toBe(2);
    // The required quantity is never reduced by a quality failure or rework.
    expect(refreshed.requiredQuantity).toBe(10);

    if (result.outcome === "recorded") {
      const preservedCheck = await db.productionQualityCheck.findUniqueOrThrow({
        where: { id: result.qualityCheckId },
      });
      expect(preservedCheck.failedQuantity).toBe(2);
    }
  });
});

describe("Completing and reopening production tasks (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  async function runToAwaitingQualityCheck(
    tracker2: ReturnType<typeof createProductionTestTracker>,
  ) {
    const seeded = await seedExportedTask(tracker2, 10);
    await startProductionTask({
      shopId: seeded.order.shopId,
      productionTaskId: seeded.task.id,
      staffUserId: seeded.staffUser.id,
    });
    await recordProductionQuantity({
      shopId: seeded.order.shopId,
      productionTaskId: seeded.task.id,
      newlyProducedQuantity: 10,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey: randomUUID(),
      staffUserId: seeded.staffUser.id,
    });
    return seeded;
  }

  it("rejects completion before the required quality check has passed", async () => {
    const { order, staffUser, task } = await runToAwaitingQualityCheck(tracker);

    const result = await completeProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("completes once fully produced and quality-approved, deriving job and order completion too", async () => {
    const { order, staffUser, task, job } = await runToAwaitingQualityCheck(tracker);
    await performQualityCheck({
      shopId: order.shopId,
      productionTaskId: task.id,
      checkedQuantity: 10,
      approvedQuantity: 10,
      failedQuantity: 0,
      checklistResult: null,
      notes: null,
      failureReason: null,
      staffUserId: staffUser.id,
    });

    const result = await completeProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });
    expect(result.outcome).toBe("completed");

    const refreshedTask = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshedTask.status).toBe("COMPLETE");
    expect(refreshedTask.completedAt).not.toBeNull();

    // A production job is only ever COMPLETE once every one of its tasks is
    // complete — here there's exactly one task, so the job derives COMPLETE.
    const refreshedJob = await db.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshedJob.status).toBe("COMPLETE");

    const refreshedOrder = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshedOrder.productionSummary).toBe("COMPLETE");
    // Completing production must never mark the order packed/fulfilled.
    expect(refreshedOrder.fulfillmentStatus).not.toBe("FULFILLED");
  });

  it("reopening requires a reason and preserves the original completion history", async () => {
    const { order, staffUser, task } = await runToAwaitingQualityCheck(tracker);
    await performQualityCheck({
      shopId: order.shopId,
      productionTaskId: task.id,
      checkedQuantity: 10,
      approvedQuantity: 10,
      failedQuantity: 0,
      checklistResult: null,
      notes: null,
      failureReason: null,
      staffUserId: staffUser.id,
    });
    await completeProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      staffUserId: staffUser.id,
    });
    const completedTask = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });

    const emptyReason = await reopenProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      reason: "   ",
      staffUserId: staffUser.id,
    });
    expect(emptyReason.outcome).toBe("rejected");

    const reopened = await reopenProductionTask({
      shopId: order.shopId,
      productionTaskId: task.id,
      reason: "Customer requested a late colourway change.",
      staffUserId: staffUser.id,
    });
    expect(reopened.outcome).toBe("reopened");

    const refreshedTask = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(refreshedTask.status).not.toBe("COMPLETE");
    expect(refreshedTask.reopenReason).toBe("Customer requested a late colourway change.");

    const override = await db.manualOverride.findFirst({
      where: { overrideType: "REOPEN_COMPLETED_PRODUCTION", relatedEntityId: task.id },
    });
    expect(override).not.toBeNull();
    expect((override?.previousValue as { status?: string } | null)?.status).toBe("COMPLETE");

    // The original completion event is never erased.
    expect(
      await db.activityEvent.count({
        where: {
          entityType: "ProductionTask",
          entityId: task.id,
          eventType: "production_task_completed",
        },
      }),
    ).toBe(1);
    expect(completedTask.completedAt).not.toBeNull();
  });
});
