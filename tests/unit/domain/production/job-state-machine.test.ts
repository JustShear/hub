import { describe, expect, it } from "vitest";
import type { ProductionTaskStatus } from "@prisma/client";
import { deriveProductionJobStatus } from "~/domain/production/job-state-machine";

function tasks(...statuses: ProductionTaskStatus[]) {
  return statuses.map((status) => ({ status }));
}

describe("deriveProductionJobStatus", () => {
  it("returns CANCELLED when every task was cancelled (nothing left non-cancelled)", () => {
    expect(deriveProductionJobStatus([])).toBe("CANCELLED");
  });

  it("returns BLOCKED if any non-cancelled task is blocked, regardless of the others", () => {
    expect(deriveProductionJobStatus(tasks("COMPLETE", "BLOCKED"))).toBe("BLOCKED");
  });

  it("returns COMPLETE only when every non-cancelled task is complete", () => {
    expect(deriveProductionJobStatus(tasks("COMPLETE", "COMPLETE"))).toBe("COMPLETE");
    expect(deriveProductionJobStatus(tasks("COMPLETE", "IN_PROGRESS"))).not.toBe("COMPLETE");
  });

  it("returns AWAITING_QUALITY_CHECK when all tasks are complete or awaiting QC", () => {
    expect(deriveProductionJobStatus(tasks("COMPLETE", "AWAITING_QUALITY_CHECK"))).toBe(
      "AWAITING_QUALITY_CHECK",
    );
  });

  it("returns IN_PROGRESS when any task is actively in progress", () => {
    expect(deriveProductionJobStatus(tasks("QUEUED", "IN_PROGRESS"))).toBe("IN_PROGRESS");
  });

  it("returns PAUSED when a task is paused and none are in progress", () => {
    expect(deriveProductionJobStatus(tasks("QUEUED", "PAUSED"))).toBe("PAUSED");
  });

  it("treats a mix of partially-complete/awaiting-QC/failed tasks as IN_PROGRESS at the job level", () => {
    expect(deriveProductionJobStatus(tasks("QUEUED", "PARTIALLY_COMPLETE"))).toBe("IN_PROGRESS");
    expect(deriveProductionJobStatus(tasks("QUEUED", "FAILED"))).toBe("IN_PROGRESS");
  });

  it("returns QUEUED when every task is still queued or ready", () => {
    expect(deriveProductionJobStatus(tasks("QUEUED", "READY"))).toBe("QUEUED");
  });
});
