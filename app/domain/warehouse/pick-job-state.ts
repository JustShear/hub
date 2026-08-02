import type { WarehousePickItemStatus, WarehousePickJobStatus } from "@prisma/client";

// A WarehousePickJob's status is always DERIVED from its items — never
// hand-set directly by a staff action, the same "recalculate, never write
// directly" principle as recalculateProductionJobStatus. HANDED_OVER is the
// one exception: reaching it is always an explicit staff action
// (handoverWarehousePickJob), never auto-derived just because every item
// reached a terminal state — mirrors how ProductionTask completion is
// explicit even though ProductionJob status is otherwise derived.

export interface PickJobItemStatusInput {
  status: WarehousePickItemStatus;
}

export function derivePickJobStatus(
  items: PickJobItemStatusInput[],
  currentStatus: WarehousePickJobStatus,
): WarehousePickJobStatus {
  if (currentStatus === "HANDED_OVER" || currentStatus === "CANCELLED") {
    return currentStatus;
  }
  const anyStarted = items.some((i) => i.status !== "PENDING");
  return anyStarted ? "IN_PROGRESS" : "QUEUED";
}
