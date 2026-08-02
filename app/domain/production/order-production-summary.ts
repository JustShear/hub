import type { OrderProductionSummary, ProductionTaskStatus } from "@prisma/client";

// Pure calculation — centralises the one rule for what
// ShopifyOrder.productionSummary should be, so no caller ever hand-picks a
// value. Rolled up from TASKS (not jobs), since ProductionJobStatus has no
// "partially complete" bucket to check but the milestone explicitly wants
// order-level partial-completion visibility. Input is always the order's
// non-cancelled tasks across its non-cancelled jobs; cancelled rows are
// excluded by the caller before this function ever sees them.

export interface ProductionTaskSummaryInput {
  status: ProductionTaskStatus;
  hasOpenBlockingIssue: boolean;
}

export function calculateOrderProductionSummary(
  nonCancelledTasks: ProductionTaskSummaryInput[],
  hasExportedArtworkWithoutJob: boolean,
): OrderProductionSummary {
  if (nonCancelledTasks.length === 0) {
    return hasExportedArtworkWithoutJob ? "READY_FOR_PRODUCTION" : "NOT_READY";
  }

  if (nonCancelledTasks.some((t) => t.hasOpenBlockingIssue || t.status === "BLOCKED")) {
    return "BLOCKED";
  }

  if (nonCancelledTasks.every((t) => t.status === "COMPLETE")) {
    return "COMPLETE";
  }

  if (
    nonCancelledTasks.every((t) => t.status === "COMPLETE" || t.status === "AWAITING_QUALITY_CHECK")
  ) {
    return "AWAITING_QUALITY_CHECK";
  }

  const anyComplete = nonCancelledTasks.some((t) => t.status === "COMPLETE");
  const anyIncomplete = nonCancelledTasks.some((t) => t.status !== "COMPLETE");
  if (anyComplete && anyIncomplete) {
    return "PARTIALLY_COMPLETE";
  }

  const anyActiveWork = nonCancelledTasks.some(
    (t) =>
      t.status === "IN_PROGRESS" ||
      t.status === "PAUSED" ||
      t.status === "PARTIALLY_COMPLETE" ||
      t.status === "AWAITING_QUALITY_CHECK" ||
      t.status === "FAILED",
  );
  if (anyActiveWork) {
    return "IN_PROGRESS";
  }

  return "QUEUED";
}
