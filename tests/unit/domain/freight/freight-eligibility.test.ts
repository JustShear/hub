import { describe, expect, it } from "vitest";
import { evaluateFreightShipmentEligibility } from "~/domain/freight/freight-eligibility";

const base = {
  productionSummary: "COMPLETE" as const,
  hasActiveShipment: false,
  orderCancelledAt: null,
};

describe("evaluateFreightShipmentEligibility", () => {
  it("allows a freight shipment once production is complete, no active shipment, order not cancelled", () => {
    expect(evaluateFreightShipmentEligibility(base).eligible).toBe(true);
  });

  it("rejects a cancelled order regardless of production state", () => {
    const result = evaluateFreightShipmentEligibility({
      ...base,
      orderCancelledAt: new Date(),
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/cancelled/i);
  });

  it("rejects when production isn't complete — no packing gate exists, so this is the one real gate", () => {
    const result = evaluateFreightShipmentEligibility({
      ...base,
      productionSummary: "IN_PROGRESS",
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/production/i);
  });

  it("rejects when an active shipment already exists for the order", () => {
    const result = evaluateFreightShipmentEligibility({ ...base, hasActiveShipment: true });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/already/i);
  });
});
