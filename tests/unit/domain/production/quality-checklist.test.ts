import { describe, expect, it } from "vitest";
import { getQualityChecklist, requiresQualityCheck } from "~/domain/production/quality-checklist";

describe("getQualityChecklist", () => {
  it("includes the universal base checklist for every decoration method", () => {
    const keys = getQualityChecklist("UNPRINTED").map((item) => item.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "correct_artwork",
        "correct_placement",
        "correct_size",
        "correct_garment",
        "no_visible_damage",
        "correct_quantity",
      ]),
    );
  });

  it("adds print-specific quality items for DTF and screen print", () => {
    const dtfKeys = getQualityChecklist("DIGITAL_PRINT_DTF").map((item) => item.key);
    expect(dtfKeys).toContain("print_quality");
    const screenKeys = getQualityChecklist("SCREEN_PRINT").map((item) => item.key);
    expect(screenKeys).toContain("print_quality");
  });

  it("adds embroidery-specific quality items for embroidery only", () => {
    const embroideryKeys = getQualityChecklist("EMBROIDERY").map((item) => item.key);
    expect(embroideryKeys).toContain("embroidery_quality");
    const unprintedKeys = getQualityChecklist("UNPRINTED").map((item) => item.key);
    expect(unprintedKeys).not.toContain("embroidery_quality");
  });

  it("never mixes method-specific items across unrelated decoration methods", () => {
    const unprintedKeys = getQualityChecklist("UNPRINTED").map((item) => item.key);
    expect(unprintedKeys).not.toContain("print_quality");
  });
});

describe("requiresQualityCheck", () => {
  it("requires a quality check for every decoration method, including unprinted garments", () => {
    expect(requiresQualityCheck("UNPRINTED")).toBe(true);
    expect(requiresQualityCheck("EMBROIDERY")).toBe(true);
    expect(requiresQualityCheck("DIGITAL_PRINT_DTF")).toBe(true);
  });
});
