// Development-only fixture generator for manually verifying the production
// queue and workstation workflow (Milestone 11). Builds on top of the
// Kanban demo fixtures (npm run db:seed:board-demo must be run first — this
// script reuses order #9022 and its demo staff), adding several new
// proof-group -> production-artwork -> export-batch chains against that
// same order, each driven through the M11 domain functions to a different
// end state covering the milestone's own manual-verification checklist.
// Entirely synthetic data. Safe to re-run: each scenario is looked up by its
// demo proof-group name first (see createExportedTask below) and reused
// rather than recreated, so running this twice never duplicates jobs/tasks.
//
// Usage:
//   npm run db:seed:board-demo
//   npm run db:seed:production-demo

import { db } from "../app/lib/db.server";
import { hashPassword } from "../app/auth/password.server";
import { randomUUID } from "node:crypto";
import { createProofGroup } from "../app/domain/proofs/create-proof-group.server";
import { createProductionArtwork } from "../app/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "../app/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "../app/domain/production/mark-production-artwork-ready.server";
import { createExportBatch } from "../app/domain/production/create-export-batch.server";
import {
  assignProductionJob,
  assignProductionTask,
} from "../app/domain/production/assign-production-task.server";
import {
  pauseProductionTask,
  resumeProductionTask,
  startProductionTask,
} from "../app/domain/production/task-lifecycle.server";
import { recordProductionQuantity } from "../app/domain/production/record-production-quantity.server";
import { performQualityCheck } from "../app/domain/production/perform-quality-check.server";
import { createProductionIssue } from "../app/domain/production/production-issue.server";
import { completeProductionTask } from "../app/domain/production/complete-production-task.server";
import { reopenProductionTask } from "../app/domain/production/reopen-production-task.server";

const DEMO_PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "utf8");
const DAY_MS = 86_400_000;

async function main() {
  const shop = await db.shop.findFirstOrThrow();

  const artworkStaff = await db.staffUser.findFirstOrThrow({
    where: { shopId: shop.id, email: "demo.artwork@justshear.example" },
  });

  const printStaffRole = await db.role.findUniqueOrThrow({
    where: { shopId_name: { shopId: shop.id, name: "PRINT_STAFF" } },
  });
  const printStaff = await db.staffUser.upsert({
    where: { shopId_email: { shopId: shop.id, email: "demo.production@justshear.example" } },
    update: {},
    create: {
      shopId: shop.id,
      email: "demo.production@justshear.example",
      name: "Sam Okafor",
      passwordHash: await hashPassword(randomUUID()),
    },
  });
  await db.staffRole.upsert({
    where: { staffUserId_roleId: { staffUserId: printStaff.id, roleId: printStaffRole.id } },
    update: {},
    create: { staffUserId: printStaff.id, roleId: printStaffRole.id },
  });

  const order9022 = await db.shopifyOrder.findFirstOrThrow({
    where: { shopId: shop.id, orderNumber: "#9022" },
    include: { lines: true },
  });
  const [varsityJacketLine, beanieLine] = order9022.lines;
  if (!varsityJacketLine || !beanieLine) {
    throw new Error(
      "Order #9022 doesn't have the expected demo lines — run `npm run db:seed:board-demo` first.",
    );
  }

  // Creates a proof group (legitimately no-proof-required, matching the
  // board demo's own "standard approved logo" scenario) -> production
  // artwork -> export batch against one of order #9022's existing lines.
  // The export batch's own success path auto-creates the ProductionJob and
  // its single ProductionTask (Milestone 11) — this helper just returns the
  // resulting task so the scenario-specific code below can drive it through
  // the M11 lifecycle functions.
  async function createExportedTask(params: {
    name: string;
    decorationMethod: "EMBROIDERY" | "DIGITAL_PRINT_DTF" | "SCREEN_PRINT" | "UNPRINTED";
    placement: string;
    lineId: string;
    quantity: number;
  }) {
    // createProofGroup itself has no name-based dedupe (each call is a plain
    // insert), so idempotency for this whole script is enforced here: if a
    // proof group with this exact demo name already exists on the order,
    // reuse its already-created job/task rather than building a duplicate
    // chain and re-walking the state machine on every re-run.
    const existingGroup = await db.proofGroup.findFirst({
      where: { orderId: order9022.id, name: params.name },
    });
    if (existingGroup) {
      const existingTask = await db.productionTask.findFirstOrThrow({
        where: { proofGroupId: existingGroup.id },
      });
      const existingJob = await db.productionJob.findUniqueOrThrow({
        where: { id: existingTask.productionJobId },
      });
      return { job: existingJob, task: existingTask };
    }

    const group = await createProofGroup({
      shopId: shop.id,
      orderId: order9022.id,
      name: params.name,
      decorationMethod: params.decorationMethod,
      placement: params.placement,
      description: null,
      requirement: "NOT_REQUIRED",
      noProofReason: "APPROVED_STANDARD_LOGO",
      noProofReasonNote: "Synthetic Milestone 11 demo scenario — repeat of a pre-approved design.",
      orderLineIds: [params.lineId],
      assetIds: [],
      assignedStaffId: artworkStaff.id,
      dueDate: null,
      priority: "NORMAL",
      staffUserId: artworkStaff.id,
    });
    if (group.outcome !== "created") {
      throw new Error(`Failed to seed proof group "${params.name}": ${JSON.stringify(group)}`);
    }

    const artwork = await createProductionArtwork({
      shopId: shop.id,
      proofGroupId: group.proofGroupId,
      fileBuffer: DEMO_PDF_BYTES,
      originalFilename: `${params.name.toLowerCase().replace(/\s+/g, "-")}-production.pdf`,
      decorationMethod: null,
      placement: params.placement,
      productionMetadata: null,
      staffUserId: artworkStaff.id,
      idempotencyKey: null,
    });
    if (artwork.outcome !== "created") {
      throw new Error(
        `Failed to seed production artwork for "${params.name}": ${JSON.stringify(artwork)}`,
      );
    }

    const allocation = await setProductionArtworkOrderLines({
      shopId: shop.id,
      productionArtworkId: artwork.productionArtworkId,
      allocations: [{ orderLineId: params.lineId, quantity: params.quantity }],
      staffUserId: artworkStaff.id,
    });
    if (allocation.outcome !== "set") {
      throw new Error(
        `Failed to allocate order lines for "${params.name}": ${JSON.stringify(allocation)}`,
      );
    }

    const ready = await markProductionArtworkReady({
      shopId: shop.id,
      productionArtworkId: artwork.productionArtworkId,
      staffUserId: artworkStaff.id,
    });
    if (ready.outcome !== "ready") {
      throw new Error(`Failed to mark "${params.name}" artwork ready: ${JSON.stringify(ready)}`);
    }

    const exportResult = await createExportBatch({
      shopId: shop.id,
      orderId: order9022.id,
      proofGroupIds: [group.proofGroupId],
      destination: "Milestone 11 demo destination",
      staffUserId: artworkStaff.id,
      idempotencyKey: `seed-production-demo-${group.proofGroupId}`,
    });
    if (exportResult.outcome !== "exported") {
      throw new Error(`Failed to export "${params.name}": ${JSON.stringify(exportResult)}`);
    }

    const task = await db.productionTask.findFirstOrThrow({
      where: { productionJob: { exportBatchId: exportResult.exportBatchId } },
    });
    return {
      job: await db.productionJob.findUniqueOrThrow({ where: { id: task.productionJobId } }),
      task,
    };
  }

  // Assigns both the job-level slot (what the queue's "assigned"
  // column/filter reads) and the task-level slot (what the workstation
  // drawer shows) — two distinct fields on two distinct models, both
  // meaningfully populated so demo scenarios exercise both.
  async function assignJobAndTask(
    job: { id: string; version: number },
    task: { id: string; version: number },
  ) {
    await assignProductionJob({
      shopId: shop.id,
      productionJobId: job.id,
      targetStaffUserId: printStaff.id,
      assignedTeam: null,
      expectedVersion: job.version,
      staffUserId: artworkStaff.id,
    });
    await assignProductionTask({
      shopId: shop.id,
      productionTaskId: task.id,
      targetStaffUserId: printStaff.id,
      expectedVersion: task.version,
      staffUserId: artworkStaff.id,
    });
  }

  // Scenario A — DTF, in progress with partial production recorded.
  const dtfPartial = await createExportedTask({
    name: "DTF partial production demo",
    decorationMethod: "DIGITAL_PRINT_DTF",
    placement: "Front chest",
    lineId: varsityJacketLine.id,
    quantity: varsityJacketLine.quantity,
  });
  await assignJobAndTask(dtfPartial.job, dtfPartial.task);
  await startProductionTask({
    shopId: shop.id,
    productionTaskId: dtfPartial.task.id,
    staffUserId: printStaff.id,
  });
  const partialQty = Math.max(1, Math.floor(dtfPartial.task.requiredQuantity / 2));
  await recordProductionQuantity({
    shopId: shop.id,
    productionTaskId: dtfPartial.task.id,
    newlyProducedQuantity: partialQty,
    newlyFailedQuantity: 0,
    reworkedQuantity: 0,
    overrideReason: null,
    idempotencyKey: "seed-dtf-partial-1",
    staffUserId: printStaff.id,
  });

  // Scenario B — Embroidery, quality check failure requiring rework, then a
  // successful rework recorded (quality-failure/rework flow).
  const embroideryRework = await createExportedTask({
    name: "Embroidery rework demo",
    decorationMethod: "EMBROIDERY",
    placement: "Right sleeve",
    lineId: beanieLine.id,
    quantity: beanieLine.quantity,
  });
  await assignJobAndTask(embroideryRework.job, embroideryRework.task);
  await startProductionTask({
    shopId: shop.id,
    productionTaskId: embroideryRework.task.id,
    staffUserId: printStaff.id,
  });
  await recordProductionQuantity({
    shopId: shop.id,
    productionTaskId: embroideryRework.task.id,
    newlyProducedQuantity: embroideryRework.task.requiredQuantity,
    newlyFailedQuantity: 0,
    reworkedQuantity: 0,
    overrideReason: null,
    idempotencyKey: "seed-embroidery-rework-1",
    staffUserId: printStaff.id,
  });
  await performQualityCheck({
    shopId: shop.id,
    productionTaskId: embroideryRework.task.id,
    checkedQuantity: embroideryRework.task.requiredQuantity,
    approvedQuantity: Math.max(0, embroideryRework.task.requiredQuantity - 1),
    failedQuantity: 1,
    checklistResult: { correct_artwork: true, embroidery_quality: false },
    notes: "One unit has loose threads — sent back for rework.",
    failureReason: "Loose threads on embroidery quality check.",
    staffUserId: printStaff.id,
  });
  await recordProductionQuantity({
    shopId: shop.id,
    productionTaskId: embroideryRework.task.id,
    newlyProducedQuantity: 0,
    newlyFailedQuantity: 0,
    reworkedQuantity: 1,
    overrideReason: null,
    idempotencyKey: "seed-embroidery-rework-2",
    staffUserId: printStaff.id,
  });

  // Scenario C — Screen print, blocked by an equipment issue.
  const screenPrintBlocked = await createExportedTask({
    name: "Screen print blocked demo",
    decorationMethod: "SCREEN_PRINT",
    placement: "Back panel",
    lineId: varsityJacketLine.id,
    quantity: varsityJacketLine.quantity,
  });
  await assignJobAndTask(screenPrintBlocked.job, screenPrintBlocked.task);
  await startProductionTask({
    shopId: shop.id,
    productionTaskId: screenPrintBlocked.task.id,
    staffUserId: printStaff.id,
  });
  await createProductionIssue({
    shopId: shop.id,
    productionJobId: screenPrintBlocked.job.id,
    productionTaskId: screenPrintBlocked.task.id,
    issueType: "EQUIPMENT_ISSUE",
    severity: "HIGH",
    description: "Screen printing press is jammed — waiting on a technician.",
    isBlocking: true,
    reworkQuantity: null,
    staffUserId: printStaff.id,
  });

  // Scenario D — Unprinted garment prep, paused (waiting for stock).
  const unprintedPaused = await createExportedTask({
    name: "Unprinted prep paused demo",
    decorationMethod: "UNPRINTED",
    placement: "N/A",
    lineId: beanieLine.id,
    quantity: beanieLine.quantity,
  });
  await assignJobAndTask(unprintedPaused.job, unprintedPaused.task);
  await startProductionTask({
    shopId: shop.id,
    productionTaskId: unprintedPaused.task.id,
    staffUserId: printStaff.id,
  });
  await pauseProductionTask({
    shopId: shop.id,
    productionTaskId: unprintedPaused.task.id,
    reasonCode: "WAITING_FOR_STOCK",
    otherText: null,
    staffUserId: printStaff.id,
  });
  // Immediately resumed so the demo also shows a real "resumed" activity
  // event and a non-zero totalPausedDurationMs, rather than staying paused.
  await resumeProductionTask({
    shopId: shop.id,
    productionTaskId: unprintedPaused.task.id,
    staffUserId: printStaff.id,
  });
  await pauseProductionTask({
    shopId: shop.id,
    productionTaskId: unprintedPaused.task.id,
    reasonCode: "WAITING_FOR_STOCK",
    otherText: null,
    staffUserId: printStaff.id,
  });

  // Scenario E — Unassigned, urgent, overdue (the queue's own default sort
  // precedence should surface this job first). Priority/due date aren't
  // exposed via a dedicated M11 service function yet (deferred — see
  // docs/development.md), so this is a direct, demo-only DB write.
  const urgentOverdue = await createExportedTask({
    name: "Urgent overdue demo",
    decorationMethod: "DIGITAL_PRINT_DTF",
    placement: "Front chest",
    lineId: varsityJacketLine.id,
    quantity: varsityJacketLine.quantity,
  });
  await db.productionJob.update({
    where: { id: urgentOverdue.job.id },
    data: { priority: "URGENT", dueDate: new Date(Date.now() - 3 * DAY_MS) },
  });

  // Scenario F — Fully completed (quality-checked and complete).
  const completed = await createExportedTask({
    name: "Completed job demo",
    decorationMethod: "EMBROIDERY",
    placement: "Left chest",
    lineId: beanieLine.id,
    quantity: beanieLine.quantity,
  });
  await assignJobAndTask(completed.job, completed.task);
  await startProductionTask({
    shopId: shop.id,
    productionTaskId: completed.task.id,
    staffUserId: printStaff.id,
  });
  await recordProductionQuantity({
    shopId: shop.id,
    productionTaskId: completed.task.id,
    newlyProducedQuantity: completed.task.requiredQuantity,
    newlyFailedQuantity: 0,
    reworkedQuantity: 0,
    overrideReason: null,
    idempotencyKey: "seed-completed-1",
    staffUserId: printStaff.id,
  });
  await performQualityCheck({
    shopId: shop.id,
    productionTaskId: completed.task.id,
    checkedQuantity: completed.task.requiredQuantity,
    approvedQuantity: completed.task.requiredQuantity,
    failedQuantity: 0,
    checklistResult: { correct_artwork: true, correct_placement: true, embroidery_quality: true },
    notes: "Passed on first check.",
    failureReason: null,
    staffUserId: printStaff.id,
  });
  const completeResult = await completeProductionTask({
    shopId: shop.id,
    productionTaskId: completed.task.id,
    staffUserId: printStaff.id,
  });
  if (completeResult.outcome === "rejected") {
    throw new Error(`Failed to complete "Completed job demo": ${JSON.stringify(completeResult)}`);
  }

  // Scenario G — Completed, then reopened with a documented reason.
  const reopened = await createExportedTask({
    name: "Reopened job demo",
    decorationMethod: "SCREEN_PRINT",
    placement: "Front chest",
    lineId: varsityJacketLine.id,
    quantity: varsityJacketLine.quantity,
  });
  await assignJobAndTask(reopened.job, reopened.task);
  await startProductionTask({
    shopId: shop.id,
    productionTaskId: reopened.task.id,
    staffUserId: printStaff.id,
  });
  await recordProductionQuantity({
    shopId: shop.id,
    productionTaskId: reopened.task.id,
    newlyProducedQuantity: reopened.task.requiredQuantity,
    newlyFailedQuantity: 0,
    reworkedQuantity: 0,
    overrideReason: null,
    idempotencyKey: "seed-reopened-1",
    staffUserId: printStaff.id,
  });
  await performQualityCheck({
    shopId: shop.id,
    productionTaskId: reopened.task.id,
    checkedQuantity: reopened.task.requiredQuantity,
    approvedQuantity: reopened.task.requiredQuantity,
    failedQuantity: 0,
    checklistResult: { correct_artwork: true },
    notes: null,
    failureReason: null,
    staffUserId: printStaff.id,
  });
  const reopenedComplete = await completeProductionTask({
    shopId: shop.id,
    productionTaskId: reopened.task.id,
    staffUserId: printStaff.id,
  });
  if (reopenedComplete.outcome === "rejected") {
    throw new Error(`Failed to complete "Reopened job demo": ${JSON.stringify(reopenedComplete)}`);
  }
  await reopenProductionTask({
    shopId: shop.id,
    productionTaskId: reopened.task.id,
    reason: "Customer requested a colourway change after the run was already completed.",
    staffUserId: artworkStaff.id,
  });

  console.log(
    "Seeded Milestone 11 production demo scenarios on order #9022: " +
      "DTF (partial production), Embroidery (rework), Screen print (blocked), " +
      "Unprinted (paused), DTF (unassigned/urgent/overdue), Embroidery (completed), " +
      "and Screen print (completed then reopened).",
  );
  console.log(`Demo Production role staff: ${printStaff.email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
