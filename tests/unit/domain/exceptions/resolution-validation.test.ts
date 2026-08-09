import { describe, expect, it } from "vitest";
import { validateResolutionInput } from "~/domain/exceptions/resolution-validation";

describe("validateResolutionInput", () => {
  it("requires a reason regardless of resolution type", () => {
    const result = validateResolutionInput({
      resolutionType: "DENIED",
      reason: "  ",
      amount: null,
      proofGroupId: null,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("reason");
  });

  it("allows DENIED with just a reason", () => {
    const result = validateResolutionInput({
      resolutionType: "DENIED",
      reason: "Investigated — no fault found",
      amount: null,
      proofGroupId: null,
    });
    expect(result.valid).toBe(true);
  });

  it.each(["CREDIT", "REFUND"] as const)("requires a positive amount for %s", (resolutionType) => {
    expect(
      validateResolutionInput({
        resolutionType,
        reason: "Customer satisfaction",
        amount: null,
        proofGroupId: null,
      }).valid,
    ).toBe(false);
    expect(
      validateResolutionInput({
        resolutionType,
        reason: "Customer satisfaction",
        amount: 0,
        proofGroupId: null,
      }).valid,
    ).toBe(false);
    expect(
      validateResolutionInput({
        resolutionType,
        reason: "Customer satisfaction",
        amount: 25.5,
        proofGroupId: null,
      }).valid,
    ).toBe(true);
  });

  it.each(["REPRINT", "EXCHANGE"] as const)(
    "allows %s with just a reason — proofGroupId is accepted but no longer required now that the export/production pipeline it used to trigger is gone",
    (resolutionType) => {
      expect(
        validateResolutionInput({
          resolutionType,
          reason: "Defective embroidery",
          amount: null,
          proofGroupId: null,
        }).valid,
      ).toBe(true);
      expect(
        validateResolutionInput({
          resolutionType,
          reason: "Defective embroidery",
          amount: null,
          proofGroupId: "group_1",
        }).valid,
      ).toBe(true);
    },
  );
});
