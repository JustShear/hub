import { describe, expect, it } from "vitest";
import { validatePauseReason } from "~/domain/production/pause-reason";

describe("validatePauseReason", () => {
  it("rejects an unrecognised reason code", () => {
    const result = validatePauseReason({ reasonCode: "NOT_A_REAL_CODE", otherText: null });
    expect(result.valid).toBe(false);
  });

  it("stores the fixed label for a non-OTHER code, ignoring any free text supplied", () => {
    const result = validatePauseReason({
      reasonCode: "WAITING_FOR_STOCK",
      otherText: "ignored text",
    });
    expect(result).toEqual({ valid: true, storedReason: "Waiting for stock" });
  });

  it("requires non-empty text when the reason is OTHER", () => {
    expect(validatePauseReason({ reasonCode: "OTHER", otherText: null }).valid).toBe(false);
    expect(validatePauseReason({ reasonCode: "OTHER", otherText: "   " }).valid).toBe(false);
  });

  it("stores the trimmed free text for a valid OTHER reason", () => {
    const result = validatePauseReason({
      reasonCode: "OTHER",
      otherText: "  Waiting on a custom dye lot  ",
    });
    expect(result).toEqual({ valid: true, storedReason: "Waiting on a custom dye lot" });
  });
});
