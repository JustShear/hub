import { describe, expect, it } from "vitest";
import { evaluateFreightShipmentEligibility } from "~/domain/freight/freight-eligibility";

const base = {
  hasActiveShipment: false,
  orderCancelledAt: null,
};

describe("evaluateFreightShipmentEligibility", () => {
  it("allows a freight shipment when not cancelled and no active shipment exists — staff are trusted to trigger this once packed", () => {
    expect(evaluateFreightShipmentEligibility(base).eligible).toBe(true);
  });

  it("rejects a cancelled order", () => {
    const result = evaluateFreightShipmentEligibility({
      ...base,
      orderCancelledAt: new Date(),
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/cancelled/i);
  });

  it("rejects when an active shipment already exists for the order", () => {
    const result = evaluateFreightShipmentEligibility({ ...base, hasActiveShipment: true });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/already/i);
  });
});
