import { describe, expect, it } from "vitest";
import { derivePickItemStatus } from "~/domain/warehouse/pick-item-state";

describe("derivePickItemStatus", () => {
  it("is PENDING when nothing has been picked or marked short", () => {
    expect(derivePickItemStatus(0, 0, 10)).toBe("PENDING");
  });

  it("is IN_PROGRESS for a partial pick", () => {
    expect(derivePickItemStatus(4, 0, 10)).toBe("IN_PROGRESS");
  });

  it("is PICKED once the full required quantity is picked", () => {
    expect(derivePickItemStatus(10, 0, 10)).toBe("PICKED");
  });

  it("is SHORT once picked + short account for the full required quantity", () => {
    expect(derivePickItemStatus(7, 3, 10)).toBe("SHORT");
  });

  it("is IN_PROGRESS when short is set but doesn't yet account for the full remainder", () => {
    expect(derivePickItemStatus(0, 3, 10)).toBe("IN_PROGRESS");
  });
});
