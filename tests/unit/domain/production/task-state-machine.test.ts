import { describe, expect, it } from "vitest";
import {
  canBlockTask,
  canPauseTask,
  canResumeTask,
  canStartTask,
  canUnblockTask,
  deriveTaskWorkingStatus,
  evaluateTaskCompletionEligibility,
  isTerminalTaskStatus,
} from "~/domain/production/task-state-machine";

describe("isTerminalTaskStatus", () => {
  it("treats COMPLETE, FAILED, and CANCELLED as terminal", () => {
    expect(isTerminalTaskStatus("COMPLETE")).toBe(true);
    expect(isTerminalTaskStatus("FAILED")).toBe(true);
    expect(isTerminalTaskStatus("CANCELLED")).toBe(true);
  });

  it("treats every other status as non-terminal", () => {
    expect(isTerminalTaskStatus("QUEUED")).toBe(false);
    expect(isTerminalTaskStatus("IN_PROGRESS")).toBe(false);
    expect(isTerminalTaskStatus("BLOCKED")).toBe(false);
  });
});

describe("canStartTask", () => {
  it("allows starting from QUEUED, READY, or PARTIALLY_COMPLETE", () => {
    expect(canStartTask("QUEUED").allowed).toBe(true);
    expect(canStartTask("READY").allowed).toBe(true);
    expect(canStartTask("PARTIALLY_COMPLETE").allowed).toBe(true);
  });

  it("rejects starting an already in-progress or terminal task", () => {
    expect(canStartTask("IN_PROGRESS").allowed).toBe(false);
    expect(canStartTask("COMPLETE").allowed).toBe(false);
    expect(canStartTask("BLOCKED").allowed).toBe(false);
  });
});

describe("canPauseTask / canResumeTask", () => {
  it("only allows pausing from IN_PROGRESS", () => {
    expect(canPauseTask("IN_PROGRESS").allowed).toBe(true);
    expect(canPauseTask("QUEUED").allowed).toBe(false);
    expect(canPauseTask("PAUSED").allowed).toBe(false);
  });

  it("only allows resuming from PAUSED", () => {
    expect(canResumeTask("PAUSED").allowed).toBe(true);
    expect(canResumeTask("IN_PROGRESS").allowed).toBe(false);
  });
});

describe("canBlockTask / canUnblockTask", () => {
  it("allows blocking active/queued statuses but not terminal ones", () => {
    expect(canBlockTask("QUEUED").allowed).toBe(true);
    expect(canBlockTask("IN_PROGRESS").allowed).toBe(true);
    expect(canBlockTask("AWAITING_QUALITY_CHECK").allowed).toBe(true);
    expect(canBlockTask("COMPLETE").allowed).toBe(false);
    expect(canBlockTask("CANCELLED").allowed).toBe(false);
  });

  it("only allows unblocking from BLOCKED", () => {
    expect(canUnblockTask("BLOCKED").allowed).toBe(true);
    expect(canUnblockTask("QUEUED").allowed).toBe(false);
  });
});

describe("deriveTaskWorkingStatus", () => {
  it("returns QUEUED when nothing has been attempted yet", () => {
    expect(
      deriveTaskWorkingStatus({
        requiredQuantity: 10,
        completedQuantity: 0,
        failedQuantity: 0,
        qualityApprovedQuantity: 0,
        requiresQualityCheck: true,
        hasPendingQualityCheckFailure: false,
      }),
    ).toBe("QUEUED");
  });

  it("returns PARTIALLY_COMPLETE once some but not all units are attempted", () => {
    expect(
      deriveTaskWorkingStatus({
        requiredQuantity: 10,
        completedQuantity: 4,
        failedQuantity: 1,
        qualityApprovedQuantity: 0,
        requiresQualityCheck: true,
        hasPendingQualityCheckFailure: false,
      }),
    ).toBe("PARTIALLY_COMPLETE");
  });

  it("returns AWAITING_QUALITY_CHECK once fully attempted and QC still owed", () => {
    expect(
      deriveTaskWorkingStatus({
        requiredQuantity: 10,
        completedQuantity: 10,
        failedQuantity: 0,
        qualityApprovedQuantity: 0,
        requiresQualityCheck: true,
        hasPendingQualityCheckFailure: false,
      }),
    ).toBe("AWAITING_QUALITY_CHECK");
  });

  it("returns PARTIALLY_COMPLETE when fully attempted but a QC failure is still pending rework", () => {
    expect(
      deriveTaskWorkingStatus({
        requiredQuantity: 10,
        completedQuantity: 10,
        failedQuantity: 0,
        qualityApprovedQuantity: 10,
        requiresQualityCheck: true,
        hasPendingQualityCheckFailure: true,
      }),
    ).toBe("PARTIALLY_COMPLETE");
  });
});

describe("evaluateTaskCompletionEligibility", () => {
  const baseInput = {
    status: "AWAITING_QUALITY_CHECK" as const,
    requiredQuantity: 10,
    completedQuantity: 10,
    failedQuantity: 0,
    qualityApprovedQuantity: 10,
    requiresQualityCheck: true,
    hasOpenBlockingIssue: false,
  };

  it("allows completion once fully produced and quality-approved with no blocking issue", () => {
    expect(evaluateTaskCompletionEligibility(baseInput).allowed).toBe(true);
  });

  it("rejects a task already in a terminal status", () => {
    expect(evaluateTaskCompletionEligibility({ ...baseInput, status: "COMPLETE" }).allowed).toBe(
      false,
    );
  });

  it("rejects while an open blocking issue exists", () => {
    expect(
      evaluateTaskCompletionEligibility({ ...baseInput, hasOpenBlockingIssue: true }).allowed,
    ).toBe(false);
  });

  it("rejects when required quantity hasn't been fully attempted", () => {
    const result = evaluateTaskCompletionEligibility({
      ...baseInput,
      completedQuantity: 6,
      qualityApprovedQuantity: 6,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("4");
  });

  it("rejects when produced units haven't all passed quality check", () => {
    expect(
      evaluateTaskCompletionEligibility({ ...baseInput, qualityApprovedQuantity: 8 }).allowed,
    ).toBe(false);
  });
});
