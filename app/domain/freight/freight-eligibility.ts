import type { OrderProductionSummary } from "@prisma/client";

// Pure — no DB access — so the UI (to grey out the "Create freight label"
// action) and the server action call the exact same rule. There is no
// Packing milestone/model yet (see ADR-0008), so "production complete" is
// the one real gate; staff are trusted to only trigger this once the order
// is actually, physically packed.
export interface FreightEligibilityInput {
  productionSummary: OrderProductionSummary;
  hasActiveShipment: boolean;
  orderCancelledAt: Date | null;
}

export interface FreightEligibilityResult {
  eligible: boolean;
  reason?: string;
}

export function evaluateFreightShipmentEligibility(
  input: FreightEligibilityInput,
): FreightEligibilityResult {
  if (input.orderCancelledAt) {
    return { eligible: false, reason: "This order is cancelled." };
  }
  if (input.productionSummary !== "COMPLETE") {
    return {
      eligible: false,
      reason: "Production must be complete before a freight label can be created.",
    };
  }
  if (input.hasActiveShipment) {
    return {
      eligible: false,
      reason: "This order already has an active freight shipment.",
    };
  }
  return { eligible: true };
}
