import type { ProductionJobStatus, ProductionTaskStatus } from "@prisma/client";

// A ProductionJob's status is always DERIVED from its (non-cancelled)
// tasks — never hand-set directly by a staff action, the same "recalculate,
// never write directly" principle as recalculateOrderProofSummary. This is
// the one function that decides it.

export interface JobTaskStatusInput {
  status: ProductionTaskStatus;
}

export function deriveProductionJobStatus(
  nonCancelledTasks: JobTaskStatusInput[],
): ProductionJobStatus {
  if (nonCancelledTasks.length === 0) {
    // Every task on this job was cancelled — the job itself has nothing
    // left to do.
    return "CANCELLED";
  }

  if (nonCancelledTasks.some((t) => t.status === "BLOCKED")) {
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
  if (nonCancelledTasks.some((t) => t.status === "IN_PROGRESS")) {
    return "IN_PROGRESS";
  }
  if (nonCancelledTasks.some((t) => t.status === "PAUSED")) {
    return "PAUSED";
  }
  // Any remaining mix — some tasks partially complete, awaiting quality
  // check, or failed while others are still queued — counts as active
  // work underway at the job level (ProductionJobStatus has no separate
  // "partially complete" bucket; that distinction lives on the task).
  if (
    nonCancelledTasks.some(
      (t) =>
        t.status === "PARTIALLY_COMPLETE" ||
        t.status === "AWAITING_QUALITY_CHECK" ||
        t.status === "FAILED",
    )
  ) {
    return "IN_PROGRESS";
  }
  // Every remaining task is QUEUED/READY — nothing has started yet.
  return "QUEUED";
}
