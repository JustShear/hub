// Pure quantity-tracking validation — no DB access, so the server action
// and the UI (to show a clear inline error before submitting) call the
// exact same logic.
//
// completedQuantity + failedQuantity is always kept <= requiredQuantity
// (short of a documented override) — every required unit is either
// successfully completed, currently failed/pending rework, or not yet
// attempted, never double-counted. A quality-check failure moves units
// FROM completed INTO failed (see quality-checklist.ts); a successful
// rework moves them back, incrementing the historical reworkQuantity
// counter without ever reducing requiredQuantity.

export interface QuantityUpdateInput {
  requiredQuantity: number;
  currentCompletedQuantity: number;
  currentFailedQuantity: number;
  /** Freshly produced units this submission (not a rework of an already-failed unit). */
  newlyProducedQuantity: number;
  /** Freshly failed units this submission (not yet reworked). */
  newlyFailedQuantity: number;
  /** Previously-failed units successfully reworked and now completed. */
  reworkedQuantity: number;
  hasQuantityOverride: boolean;
}

export interface QuantityUpdateResult {
  valid: boolean;
  reason?: string;
  nextCompletedQuantity?: number;
  nextFailedQuantity?: number;
}

export function validateQuantityUpdate(input: QuantityUpdateInput): QuantityUpdateResult {
  if (
    input.newlyProducedQuantity < 0 ||
    input.newlyFailedQuantity < 0 ||
    input.reworkedQuantity < 0
  ) {
    return { valid: false, reason: "Quantities cannot be negative." };
  }
  if (
    !Number.isInteger(input.newlyProducedQuantity) ||
    !Number.isInteger(input.newlyFailedQuantity) ||
    !Number.isInteger(input.reworkedQuantity)
  ) {
    return { valid: false, reason: "Quantities must be whole numbers." };
  }
  if (input.reworkedQuantity > input.currentFailedQuantity) {
    return {
      valid: false,
      reason: "Can't rework more units than are currently marked failed.",
    };
  }
  if (
    input.newlyProducedQuantity === 0 &&
    input.newlyFailedQuantity === 0 &&
    input.reworkedQuantity === 0
  ) {
    return { valid: false, reason: "Enter at least one quantity greater than zero." };
  }

  const nextCompleted =
    input.currentCompletedQuantity + input.newlyProducedQuantity + input.reworkedQuantity;
  const nextFailed =
    input.currentFailedQuantity - input.reworkedQuantity + input.newlyFailedQuantity;
  const attempted = nextCompleted + nextFailed;

  if (attempted > input.requiredQuantity && !input.hasQuantityOverride) {
    return {
      valid: false,
      reason: `This would record ${attempted} unit(s) against a required quantity of ${input.requiredQuantity}. Exceeding the required quantity needs a documented override.`,
    };
  }

  return { valid: true, nextCompletedQuantity: nextCompleted, nextFailedQuantity: nextFailed };
}

export interface QualityCheckQuantityInput {
  currentCompletedQuantity: number;
  currentQualityApprovedQuantity: number;
  checkedQuantity: number;
  approvedQuantity: number;
  failedQuantity: number;
}

export interface QualityCheckQuantityResult {
  valid: boolean;
  reason?: string;
}

/** Do this quality-check submission's own quantities add up? */
export function validateQualityCheckQuantities(
  input: QualityCheckQuantityInput,
): QualityCheckQuantityResult {
  if (input.checkedQuantity < 0 || input.approvedQuantity < 0 || input.failedQuantity < 0) {
    return { valid: false, reason: "Quantities cannot be negative." };
  }
  if (input.checkedQuantity === 0) {
    return { valid: false, reason: "Checked quantity must be greater than zero." };
  }
  if (input.approvedQuantity + input.failedQuantity !== input.checkedQuantity) {
    return {
      valid: false,
      reason: "Approved plus failed quantity must equal the checked quantity.",
    };
  }
  const uncheckedCompleted = input.currentCompletedQuantity - input.currentQualityApprovedQuantity;
  if (input.checkedQuantity > uncheckedCompleted) {
    return {
      valid: false,
      reason: `Only ${uncheckedCompleted} completed unit(s) are awaiting a quality check.`,
    };
  }
  return { valid: true };
}
