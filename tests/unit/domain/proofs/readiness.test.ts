import { describe, expect, it } from "vitest";
import {
  validateProofGroupReadiness,
  type ProofGroupReadinessInput,
} from "~/domain/proofs/readiness";

function baseInput(overrides: Partial<ProofGroupReadinessInput> = {}): ProofGroupReadinessInput {
  return {
    name: "Left chest embroidery",
    placement: "Left chest",
    decorationMethod: "EMBROIDERY",
    requirementValue: "REQUIRED",
    linkedLineCount: 1,
    currentVersion: { status: "DRAFT", hasStoredFile: true },
    hasOpenIntegrationFailure: false,
    ...overrides,
  };
}

describe("validateProofGroupReadiness", () => {
  it("is ready when every requirement is satisfied", () => {
    expect(validateProofGroupReadiness(baseInput())).toMatchObject({ ready: true, issues: [] });
  });

  it("is not ready when the requirement is UNDETERMINED", () => {
    const result = validateProofGroupReadiness(baseInput({ requirementValue: "UNDETERMINED" }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.includes("Proof required"))).toBe(true);
  });

  it("is not ready when no order lines are linked", () => {
    const result = validateProofGroupReadiness(baseInput({ linkedLineCount: 0 }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.includes("order line"))).toBe(true);
  });

  it("is not ready when there is no current version", () => {
    const result = validateProofGroupReadiness(baseInput({ currentVersion: null }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.includes("no proof version"))).toBe(true);
  });

  it("is not ready when the current version has no stored file", () => {
    const result = validateProofGroupReadiness(
      baseInput({ currentVersion: { status: "DRAFT", hasStoredFile: false } }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.includes("no successfully uploaded proof file"))).toBe(true);
  });

  it("is not ready when the current version is cancelled", () => {
    const result = validateProofGroupReadiness(
      baseInput({ currentVersion: { status: "CANCELLED", hasStoredFile: true } }),
    );
    expect(result.ready).toBe(false);
  });

  it("does not require placement — it's optional metadata, not a readiness gate", () => {
    const result = validateProofGroupReadiness(baseInput({ placement: null }));
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.includes("Placement"))).toBe(false);
  });

  it("is not ready when the group name is blank", () => {
    const result = validateProofGroupReadiness(baseInput({ name: "   " }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.includes("name"))).toBe(true);
  });

  it("is not ready when there is an open integration failure", () => {
    const result = validateProofGroupReadiness(baseInput({ hasOpenIntegrationFailure: true }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.includes("unresolved upload or storage issue"))).toBe(true);
  });

  it("reports every issue at once rather than stopping at the first", () => {
    const result = validateProofGroupReadiness(
      baseInput({ requirementValue: "UNDETERMINED", linkedLineCount: 0, currentVersion: null }),
    );
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});
