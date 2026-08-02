import { describe, expect, it } from "vitest";
import type { ProductionTaskStatus } from "@prisma/client";
import { calculateOrderProductionSummary } from "~/domain/production/order-production-summary";

function task(status: ProductionTaskStatus, hasOpenBlockingIssue = false) {
  return { status, hasOpenBlockingIssue };
}

describe("calculateOrderProductionSummary", () => {
  it("returns NOT_READY when there are no tasks and no exported-but-unjobbed artwork", () => {
    expect(calculateOrderProductionSummary([], false)).toBe("NOT_READY");
  });

  it("returns READY_FOR_PRODUCTION when artwork is exported but no job exists yet", () => {
    expect(calculateOrderProductionSummary([], true)).toBe("READY_FOR_PRODUCTION");
  });

  it("returns BLOCKED if any task is blocked or has an open blocking issue", () => {
    expect(calculateOrderProductionSummary([task("BLOCKED")], false)).toBe("BLOCKED");
    expect(calculateOrderProductionSummary([task("IN_PROGRESS", true)], false)).toBe("BLOCKED");
  });

  it("returns COMPLETE only when every task is complete", () => {
    expect(calculateOrderProductionSummary([task("COMPLETE"), task("COMPLETE")], false)).toBe(
      "COMPLETE",
    );
  });

  it("returns AWAITING_QUALITY_CHECK when everything is complete or awaiting QC", () => {
    expect(
      calculateOrderProductionSummary([task("COMPLETE"), task("AWAITING_QUALITY_CHECK")], false),
    ).toBe("AWAITING_QUALITY_CHECK");
  });

  it("returns PARTIALLY_COMPLETE when some tasks are complete and others aren't", () => {
    expect(calculateOrderProductionSummary([task("COMPLETE"), task("QUEUED")], false)).toBe(
      "PARTIALLY_COMPLETE",
    );
  });

  it("returns IN_PROGRESS when active work exists but nothing is complete yet", () => {
    expect(calculateOrderProductionSummary([task("QUEUED"), task("IN_PROGRESS")], false)).toBe(
      "IN_PROGRESS",
    );
  });

  it("returns QUEUED when every task is still queued/ready with no active work", () => {
    expect(calculateOrderProductionSummary([task("QUEUED"), task("READY")], false)).toBe("QUEUED");
  });
});
