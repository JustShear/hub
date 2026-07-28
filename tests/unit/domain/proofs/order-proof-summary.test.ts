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

  it("never returns a customer-waiting or approval state", () => {
    const groups = [group({ hasAnyVersion: true, isReadyToSend: true })];
    const result = calculateOrderProofSummary(groups);
    expect(result).not.toBe("WAITING_ON_CUSTOMER");
    expect(result).not.toBe("PARTIALLY_APPROVED");
    expect(result).not.toBe("ALL_REQUIRED_PROOFS_APPROVED");
  });
});
