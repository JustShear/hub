import { describe, expect, it } from "vitest";
import { validateScan } from "~/domain/barcodes/validate-scan";

describe("validateScan", () => {
  it("returns UNKNOWN when there's nothing to validate against", () => {
    expect(validateScan("ABC123", null)).toBe("UNKNOWN");
  });

  it("returns MATCH for an exact match, tolerating surrounding whitespace", () => {
    expect(validateScan("ABC123", "ABC123")).toBe("MATCH");
    expect(validateScan("  ABC123  ", "ABC123")).toBe("MATCH");
  });

  it("returns MISMATCH for a genuine difference", () => {
    expect(validateScan("ABC123", "XYZ999")).toBe("MISMATCH");
  });

  it("is case-sensitive — a barcode is not a human-typed label", () => {
    expect(validateScan("abc123", "ABC123")).toBe("MISMATCH");
  });
});
