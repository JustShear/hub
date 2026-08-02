import { describe, expect, it } from "vitest";
import {
  validateQualityCheckQuantities,
  validateQuantityUpdate,
} from "~/domain/production/quantity-validation";

describe("validateQuantityUpdate", () => {
  const base = {
    requiredQuantity: 10,
    currentCompletedQuantity: 0,
    currentFailedQuantity: 0,
    newlyProducedQuantity: 0,
    newlyFailedQuantity: 0,
    reworkedQuantity: 0,
    hasQuantityOverride: false,
  };

  it("rejects negative quantities", () => {
    expect(validateQuantityUpdate({ ...base, newlyProducedQuantity: -1 }).valid).toBe(false);
  });

  it("rejects non-integer quantities", () => {
    expect(validateQuantityUpdate({ ...base, newlyProducedQuantity: 1.5 }).valid).toBe(false);
  });

  it("rejects reworking more units than are currently failed", () => {
    expect(
      validateQuantityUpdate({ ...base, currentFailedQuantity: 2, reworkedQuantity: 3 }).valid,
    ).toBe(false);
  });

  it("rejects an all-zero submission", () => {
    expect(validateQuantityUpdate(base).valid).toBe(false);
  });

  it("computes the next completed/failed totals for a normal partial update", () => {
    const result = validateQuantityUpdate({
      ...base,
      currentCompletedQuantity: 3,
      newlyProducedQuantity: 4,
      newlyFailedQuantity: 1,
    });
    expect(result).toEqual({ valid: true, nextCompletedQuantity: 7, nextFailedQuantity: 1 });
  });

  it("moves reworked units from failed back to completed and increments completed accordingly", () => {
    const result = validateQuantityUpdate({
      ...base,
      currentCompletedQuantity: 5,
      currentFailedQuantity: 2,
      reworkedQuantity: 2,
    });
    expect(result).toEqual({ valid: true, nextCompletedQuantity: 7, nextFailedQuantity: 0 });
  });

  it("rejects exceeding the required quantity without an override", () => {
    const result = validateQuantityUpdate({
      ...base,
      currentCompletedQuantity: 9,
      newlyProducedQuantity: 5,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("override");
  });

  it("allows exceeding the required quantity when a documented override is present", () => {
    const result = validateQuantityUpdate({
      ...base,
      currentCompletedQuantity: 9,
      newlyProducedQuantity: 5,
      hasQuantityOverride: true,
    });
    expect(result.valid).toBe(true);
    expect(result.nextCompletedQuantity).toBe(14);
  });
});

describe("validateQualityCheckQuantities", () => {
  const base = {
    currentCompletedQuantity: 10,
    currentQualityApprovedQuantity: 0,
    checkedQuantity: 10,
    approvedQuantity: 8,
    failedQuantity: 2,
  };

  it("rejects a zero checked quantity", () => {
    expect(
      validateQualityCheckQuantities({ ...base, checkedQuantity: 0, approvedQuantity: 0 }).valid,
    ).toBe(false);
  });

  it("rejects when approved + failed doesn't equal checked", () => {
    expect(
      validateQualityCheckQuantities({ ...base, approvedQuantity: 5, failedQuantity: 2 }).valid,
    ).toBe(false);
  });

  it("rejects checking more units than are currently awaiting quality check", () => {
    const result = validateQualityCheckQuantities({
      ...base,
      currentQualityApprovedQuantity: 5,
      checkedQuantity: 10,
      approvedQuantity: 8,
      failedQuantity: 2,
    });
    // Only 10 - 5 = 5 units are unchecked, but 10 were submitted.
    expect(result.valid).toBe(false);
  });

  it("accepts a fully valid quality-check submission", () => {
    expect(validateQualityCheckQuantities(base).valid).toBe(true);
  });
});
