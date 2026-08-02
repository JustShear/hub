import { describe, expect, it } from "vitest";
import { evaluateHandoverEligibility } from "~/domain/warehouse/handover-eligibility";

describe("evaluateHandoverEligibility", () => {
  it("rejects a cancelled job", () => {
    const result = evaluateHandoverEligibility("CANCELLED", [{ status: "PICKED" }]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/cancelled/i);
  });

  it("rejects a job that's already been handed over", () => {
    const result = evaluateHandoverEligibility("HANDED_OVER", [{ status: "PICKED" }]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/already/i);
  });

  it("rejects when any item is still PENDING or IN_PROGRESS", () => {
    const result = evaluateHandoverEligibility("IN_PROGRESS", [
      { status: "PICKED" },
      { status: "PENDING" },
    ]);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/1 line/i);
  });

  it("allows handover once every item is PICKED or SHORT — a short item never blocks it", () => {
    const result = evaluateHandoverEligibility("IN_PROGRESS", [
      { status: "PICKED" },
      { status: "SHORT" },
    ]);
    expect(result.eligible).toBe(true);
  });
});
