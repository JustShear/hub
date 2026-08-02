// Pure quantity-tracking validation — no DB access, so the server action
// and the UI (to show a clear inline error before submitting) call the
// exact same logic.
//
// pickedQuantity + shortQuantity is always kept <= requiredQuantity — every
// required unit is either genuinely gathered, explicitly marked short, or
// not yet accounted for, never double-counted.

export interface PickQuantityUpdateInput {
  requiredQuantity: number;
  currentPickedQuantity: number;
  currentShortQuantity: number;
  /** Freshly picked units this submission. */
  newlyPickedQuantity: number;
}

export interface PickQuantityUpdateResult {
  valid: boolean;
  reason?: string;
  nextPickedQuantity?: number;
}

export function validatePickQuantityUpdate(
  input: PickQuantityUpdateInput,
): PickQuantityUpdateResult {
  if (input.newlyPickedQuantity <= 0) {
    return { valid: false, reason: "Enter a picked quantity greater than zero." };
  }
  if (!Number.isInteger(input.newlyPickedQuantity)) {
    return { valid: false, reason: "Quantity must be a whole number." };
  }

  const nextPicked = input.currentPickedQuantity + input.newlyPickedQuantity;
  const attempted = nextPicked + input.currentShortQuantity;

  if (attempted > input.requiredQuantity) {
    const remaining =
      input.requiredQuantity - input.currentPickedQuantity - input.currentShortQuantity;
    return {
      valid: false,
      reason: `Only ${Math.max(remaining, 0)} unit(s) remain to be picked for this line.`,
    };
  }

  return { valid: true, nextPickedQuantity: nextPicked };
}

export interface MarkShortInput {
  requiredQuantity: number;
  currentPickedQuantity: number;
  currentShortQuantity: number;
}

export interface MarkShortResult {
  valid: boolean;
  reason?: string;
  shortQuantity?: number;
}

/** How many units remain unaccounted for, and can therefore be marked short. */
export function calculateShortQuantity(input: MarkShortInput): MarkShortResult {
  const remaining =
    input.requiredQuantity - input.currentPickedQuantity - input.currentShortQuantity;
  if (remaining <= 0) {
    return {
      valid: false,
      reason: "This line is already fully accounted for — nothing remains to mark short.",
    };
  }
  return { valid: true, shortQuantity: input.currentShortQuantity + remaining };
}
