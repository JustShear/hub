import { describe, expect, it } from "vitest";
import {
  calculateOrderProofSummary,
  type ProofGroupSummaryInput,
} from "~/domain/proofs/order-proof-summary";

function group(overrides: Partial<ProofGroupSummaryInput> = {}): ProofGroupSummaryInput {
  return {
    isReadyToSend: false,
    hasAnyVersion: false,
    isNoProofRequired: false,
    hasOpenIntegrationFailure: false,
    isWaitingOnCustomer: false,
    isApproved: false,
    isChangesRequested: false,
    isReadyForExport: false,
    isExportedForPrint: false,
    ...overrides,
  };
}

describe("calculateOrderProofSummary", () => {
  it("returns PROOFS_NOT_STARTED when there are no proof groups at all", () => {
    expect(calculateOrderProofSummary([])).toBe("PROOFS_NOT_STARTED");
  });

  it("returns NO_PROOFS_REQUIRED when every group is legitimately no-proof-required", () => {
    const groups = [group({ isNoProofRequired: true }), group({ isNoProofRequired: true })];
    expect(calculateOrderProofSummary(groups)).toBe("NO_PROOFS_REQUIRED");
  });

  it("returns PROOFS_NOT_STARTED when a required group exists but has no version yet", () => {
    const groups = [group({ hasAnyVersion: false })];
    expect(calculateOrderProofSummary(groups)).toBe("PROOFS_NOT_STARTED");
  });

  it("returns PROOFS_IN_PROGRESS when a required group has a version but isn't ready yet", () => {
    const groups = [group({ hasAnyVersion: true, isReadyToSend: false })];
    expect(calculateOrderProofSummary(groups)).toBe("PROOFS_IN_PROGRESS");
  });

  it("returns READY_TO_SEND only when every required group is ready", () => {
    const groups = [
      group({ hasAnyVersion: true, isReadyToSend: true }),
      group({ hasAnyVersion: true, isReadyToSend: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("READY_TO_SEND");
  });

  it("does not return READY_TO_SEND if only some required groups are ready", () => {
    const groups = [
      group({ hasAnyVersion: true, isReadyToSend: true }),
      group({ hasAnyVersion: true, isReadyToSend: false }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("PROOFS_IN_PROGRESS");
  });

  it("returns BLOCKED when any required group has an open integration failure, even if others are ready", () => {
    const groups = [
      group({ hasAnyVersion: true, isReadyToSend: true }),
      group({ hasAnyVersion: true, hasOpenIntegrationFailure: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("BLOCKED");
  });

  it("ignores a no-proof-required group's own state when checking readiness of the rest", () => {
    const groups = [
      group({ isNoProofRequired: true }),
      group({ hasAnyVersion: true, isReadyToSend: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("READY_TO_SEND");
  });

  it("returns WAITING_ON_CUSTOMER when a required group has been sent/viewed with no terminal response", () => {
    const groups = [group({ hasAnyVersion: true, isWaitingOnCustomer: true })];
    expect(calculateOrderProofSummary(groups)).toBe("WAITING_ON_CUSTOMER");
  });

  it("returns ALL_REQUIRED_PROOFS_APPROVED only when every required group is approved", () => {
    const groups = [
      group({ hasAnyVersion: true, isApproved: true }),
      group({ hasAnyVersion: true, isApproved: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("ALL_REQUIRED_PROOFS_APPROVED");
  });

  it("returns PARTIALLY_APPROVED when some but not all required groups are approved", () => {
    const groups = [
      group({ hasAnyVersion: true, isApproved: true }),
      group({ hasAnyVersion: true, isWaitingOnCustomer: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("PARTIALLY_APPROVED");
  });

  it("returns PARTIALLY_APPROVED when one group is approved and another is still only ready to send", () => {
    const groups = [
      group({ hasAnyVersion: true, isApproved: true }),
      group({ hasAnyVersion: true, isReadyToSend: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("PARTIALLY_APPROVED");
  });

  it("returns CHANGES_REQUESTED when any required group has changes requested, even if others are approved", () => {
    const groups = [
      group({ hasAnyVersion: true, isApproved: true }),
      group({ hasAnyVersion: true, isChangesRequested: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("CHANGES_REQUESTED");
  });

  it("prioritises BLOCKED over CHANGES_REQUESTED", () => {
    const groups = [
      group({ hasAnyVersion: true, isChangesRequested: true }),
      group({ hasAnyVersion: true, hasOpenIntegrationFailure: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("BLOCKED");
  });

  it("a no-proof-required group never counts toward approval/waiting states", () => {
    const groups = [
      group({ isNoProofRequired: true }),
      group({ hasAnyVersion: true, isApproved: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("ALL_REQUIRED_PROOFS_APPROVED");
  });

  it("returns ALL_REQUIRED_PROOFS_APPROVED when a group has reached READY_FOR_EXPORT (Milestone 10)", () => {
    const groups = [
      group({ hasAnyVersion: true, isApproved: true }),
      group({ hasAnyVersion: true, isReadyForExport: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("ALL_REQUIRED_PROOFS_APPROVED");
  });

  it("returns PARTIALLY_EXPORTED when some but not all required groups are exported", () => {
    const groups = [
      group({ hasAnyVersion: true, isExportedForPrint: true }),
      group({ hasAnyVersion: true, isApproved: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("PARTIALLY_EXPORTED");
  });

  it("returns ALL_REQUIRED_PROOFS_EXPORTED only when every required group is exported", () => {
    const groups = [
      group({ hasAnyVersion: true, isExportedForPrint: true }),
      group({ hasAnyVersion: true, isExportedForPrint: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("ALL_REQUIRED_PROOFS_EXPORTED");
  });

  it("prioritises exported states over approved states", () => {
    const groups = [group({ hasAnyVersion: true, isExportedForPrint: true })];
    expect(calculateOrderProofSummary(groups)).toBe("ALL_REQUIRED_PROOFS_EXPORTED");
  });

  it("prioritises CHANGES_REQUESTED over an already-exported sibling group", () => {
    const groups = [
      group({ hasAnyVersion: true, isExportedForPrint: true }),
      group({ hasAnyVersion: true, isChangesRequested: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("CHANGES_REQUESTED");
  });

  it("prioritises BLOCKED over an already-exported sibling group", () => {
    const groups = [
      group({ hasAnyVersion: true, isExportedForPrint: true }),
      group({ hasAnyVersion: true, hasOpenIntegrationFailure: true }),
    ];
    expect(calculateOrderProofSummary(groups)).toBe("BLOCKED");
  });
});
