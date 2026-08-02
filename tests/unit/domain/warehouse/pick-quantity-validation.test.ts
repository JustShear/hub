import { describe, expect, it } from "vitest";
import {
  calculateShortQuantity,
  validatePickQuantityUpdate,
} from "~/domain/warehouse/pick-quantity-validation";

describe("validatePickQuantityUpdate", () => {
  it("rejects a zero or negative quantity", () => {
    const result = validatePickQuantityUpdate({
      requiredQuantity: 10,
      currentPickedQuantity: 0,
      currentShortQuantity: 0,
      newlyPickedQuantity: 0,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a non-integer quantity", () => {
    const result = validatePickQuantityUpdate({
      requiredQuantity: 10,
      currentPickedQuantity: 0,
      currentShortQuantity: 0,
      newlyPickedQuantity: 1.5,
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a valid partial pick and returns the next total", () => {
    const result = validatePickQuantityUpdate({
      requiredQuantity: 10,
      currentPickedQuantity: 3,
      currentShortQuantity: 0,
      newlyPickedQuantity: 4,
    });
    expect(result).toEqual({ valid: true, nextPickedQuantity: 7 });
  });

  it("rejects a pick that would exceed the required quantity", () => {
    const result = validatePickQuantityUpdate({
      requiredQuantity: 10,
      currentPickedQuantity: 8,
      currentShortQuantity: 0,
      newlyPickedQuantity: 5,
    });
    expect(result.valid).toBe(false);
  });

  it("accounts for an existing short quantity when computing remaining capacity", () => {
    const result = validatePickQuantityUpdate({
      requiredQuantity: 10,
      currentPickedQuantity: 2,
      currentShortQuantity: 5,
      newlyPickedQuantity: 4,
    });
    expect(result.valid).toBe(false);
  });
});

describe("calculateShortQuantity", () => {
  it("rejects marking short when nothing remains unaccounted for", () => {
    const result = calculateShortQuantity({
      requiredQuantity: 10,
      currentPickedQuantity: 10,
      currentShortQuantity: 0,
    });
    expect(result.valid).toBe(false);
  });

  it("marks the full remainder as short", () => {
    const result = calculateShortQuantity({
      requiredQuantity: 10,
      currentPickedQuantity: 6,
      currentShortQuantity: 0,
    });
    expect(result).toEqual({ valid: true, shortQuantity: 4 });
  });

  it("adds to an already-existing short quantity", () => {
    const result = calculateShortQuantity({
      requiredQuantity: 10,
      currentPickedQuantity: 4,
      currentShortQuantity: 2,
    });
    expect(result).toEqual({ valid: true, shortQuantity: 6 });
  });
});
