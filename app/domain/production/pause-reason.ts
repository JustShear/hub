import {
  PAUSE_REASONS,
  PAUSE_REASON_LABELS,
  type PauseReasonCode,
} from "~/domain/production/labels";

export interface PauseReasonInput {
  reasonCode: string;
  otherText: string | null;
}

export type PauseReasonValidationResult =
  { valid: true; storedReason: string } | { valid: false; error: string };

/**
 * OTHER requires accompanying free text; every other code stores its own
 * fixed label (never raw free text) so pause-reason reporting stays
 * consistent across every task, matching the milestone's fixed-vocabulary
 * requirement.
 */
export function validatePauseReason(input: PauseReasonInput): PauseReasonValidationResult {
  if (!PAUSE_REASONS.includes(input.reasonCode as PauseReasonCode)) {
    return { valid: false, error: "Select a valid pause reason." };
  }
  const code = input.reasonCode as PauseReasonCode;
  if (code === "OTHER") {
    const trimmed = (input.otherText ?? "").trim();
    if (!trimmed) {
      return { valid: false, error: 'A description is required when the reason is "Other".' };
    }
    return { valid: true, storedReason: trimmed };
  }
  return { valid: true, storedReason: PAUSE_REASON_LABELS[code] };
}
