// Pure — no DB access — so the UI (to grey out the "Create freight label"
// action) and the server action call the exact same rule. There is no
// Packing milestone/model yet (see ADR-0008), so staff are trusted to only
// trigger this once the order is actually, physically packed — same trust
// model as the "Mark fulfilled — no label needed" bypass.
export interface FreightEligibilityInput {
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
  if (input.hasActiveShipment) {
    return {
      eligible: false,
      reason: "This order already has an active freight shipment.",
    };
  }
  return { eligible: true };
}
