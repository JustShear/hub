import { describe, expect, it } from "vitest";
import {
  evaluateExportBatchItemEligibility,
  evaluateProductionArtworkEligibility,
  evaluateReadyForExportEligibility,
  validateProductionArtworkMetadata,
} from "~/domain/production/eligibility";

describe("evaluateProductionArtworkEligibility", () => {
  it("is eligible on the approved-version path", () => {
    const result = evaluateProductionArtworkEligibility({
      orderStatus: "PROOFING_IN_PROGRESS",
      proofGroupStatus: "APPROVED",
      noProofReason: null,
      currentVersion: { id: "v1", status: "APPROVED" },
    });
    expect(result).toEqual({ eligible: true, path: "approved_version", reasons: [] });
  });

  it("is eligible on the no-proof-required path when a reason is recorded", () => {
    const result = evaluateProductionArtworkEligibility({
      orderStatus: "PROOFING_IN_PROGRESS",
      proofGroupStatus: "NO_PROOF_REQUIRED",
      noProofReason: "APPROVED_STANDARD_LOGO",
      currentVersion: null,
    });
    expect(result).toEqual({ eligible: true, path: "no_proof_required", reasons: [] });
  });

  it("rejects a no-proof-required group missing its documented reason", () => {
    const result = evaluateProductionArtworkEligibility({
      orderStatus: "PROOFING_IN_PROGRESS",
      proofGroupStatus: "NO_PROOF_REQUIRED",
      noProofReason: null,
      currentVersion: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.path).toBeNull();
  });

  it("rejects a group whose current version is no longer approved (reopened/superseded)", () => {
    const result = evaluateProductionArtworkEligibility({
      orderStatus: "PROOFING_IN_PROGRESS",
      proofGroupStatus: "APPROVED",
      noProofReason: null,
      currentVersion: { id: "v1", status: "CHANGES_REQUESTED" },
    });
    expect(result.eligible).toBe(false);
  });

  it("rejects a group in a non-eligible status (e.g. still in draft)", () => {
    const result = evaluateProductionArtworkEligibility({
      orderStatus: "PROOFING_IN_PROGRESS",
      proofGroupStatus: "DRAFT_IN_PROGRESS",
      noProofReason: null,
      currentVersion: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.path).toBeNull();
  });

  it("rejects when the order is cancelled, even if the group looks eligible", () => {
    const result = evaluateProductionArtworkEligibility({
      orderStatus: "CANCELLED",
      proofGroupStatus: "APPROVED",
      noProofReason: null,
      currentVersion: { id: "v1", status: "APPROVED" },
    });
    expect(result.eligible).toBe(false);
  });

  it("allows re-preparing artwork for a group that already reached READY_FOR_EXPORT/EXPORTED_FOR_PRINT", () => {
    for (const status of ["READY_FOR_EXPORT", "EXPORTED_FOR_PRINT"] as const) {
      const result = evaluateProductionArtworkEligibility({
        orderStatus: "PROOFING_IN_PROGRESS",
        proofGroupStatus: status,
        noProofReason: null,
        currentVersion: { id: "v1", status: "APPROVED" },
      });
      expect(result.eligible).toBe(true);
    }
  });
});

describe("evaluateReadyForExportEligibility", () => {
  it("is eligible when validated, has a file, and has at least one line allocated", () => {
    const result = evaluateReadyForExportEligibility({
      artworkStatus: "DRAFT",
      validationStatus: true,
      hasStoredFile: true,
      allocatedLineCount: 1,
    });
    expect(result.eligible).toBe(true);
  });

  it("rejects when validation hasn't passed", () => {
    const result = evaluateReadyForExportEligibility({
      artworkStatus: "DRAFT",
      validationStatus: false,
      hasStoredFile: true,
      allocatedLineCount: 1,
    });
    expect(result.eligible).toBe(false);
  });

  it("rejects when no order lines are allocated", () => {
    const result = evaluateReadyForExportEligibility({
      artworkStatus: "DRAFT",
      validationStatus: true,
      hasStoredFile: true,
      allocatedLineCount: 0,
    });
    expect(result.eligible).toBe(false);
  });

  it("rejects an already-exported, superseded, or cancelled revision", () => {
    for (const status of ["EXPORTED", "SUPERSEDED", "CANCELLED"] as const) {
      const result = evaluateReadyForExportEligibility({
        artworkStatus: status,
        validationStatus: true,
        hasStoredFile: true,
        allocatedLineCount: 1,
      });
      expect(result.eligible).toBe(false);
    }
  });
});

describe("evaluateExportBatchItemEligibility", () => {
  const baseInput = {
    orderStatus: "PROOFING_IN_PROGRESS" as const,
    proofGroupStatus: "READY_FOR_EXPORT" as const,
    artworkStatus: "READY_FOR_EXPORT" as const,
    sourceVersionStillApproved: true,
  };

  it("is eligible when the artwork is ready, the group is in an eligible status, and the source version still holds", () => {
    expect(evaluateExportBatchItemEligibility(baseInput).eligible).toBe(true);
  });

  it("rejects when the order is cancelled", () => {
    expect(
      evaluateExportBatchItemEligibility({ ...baseInput, orderStatus: "CANCELLED" }).eligible,
    ).toBe(false);
  });

  it("rejects when the artwork isn't marked ready for export", () => {
    expect(
      evaluateExportBatchItemEligibility({ ...baseInput, artworkStatus: "DRAFT" }).eligible,
    ).toBe(false);
  });

  it("rejects when the source proof version is no longer approved (reopened since)", () => {
    expect(
      evaluateExportBatchItemEligibility({ ...baseInput, sourceVersionStillApproved: false })
        .eligible,
    ).toBe(false);
  });

  it("does not reject when there is no source version at all (the no-proof-required path)", () => {
    expect(
      evaluateExportBatchItemEligibility({ ...baseInput, sourceVersionStillApproved: null })
        .eligible,
    ).toBe(true);
  });
});

describe("validateProductionArtworkMetadata", () => {
  it("passes when placement is set for a printed decoration method", () => {
    const result = validateProductionArtworkMetadata({
      decorationMethod: "SCREEN_PRINT",
      placement: "Front chest",
    });
    expect(result).toEqual({ passed: true, messages: [] });
  });

  it("fails when placement is missing for a printed decoration method", () => {
    const result = validateProductionArtworkMetadata({
      decorationMethod: "SCREEN_PRINT",
      placement: null,
    });
    expect(result.passed).toBe(false);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("does not require placement for UNPRINTED", () => {
    const result = validateProductionArtworkMetadata({
      decorationMethod: "UNPRINTED",
      placement: null,
    });
    expect(result).toEqual({ passed: true, messages: [] });
  });
});
