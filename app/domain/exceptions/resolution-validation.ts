import type { ExceptionResolutionType } from "@prisma/client";

export interface ResolutionInput {
  resolutionType: ExceptionResolutionType;
  reason: string;
  amount: number | null;
  proofGroupId: string | null;
}

export interface ResolutionValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * CREDIT/REFUND require a positive amount (record-only — no Shopify money
 * movement, see ADR-0010); REPRINT/EXCHANGE require a proof group to
 * re-export (the same field, since both mechanically reuse
 * createExportBatch/reExportBatch — the difference between them is only
 * *why*, not *how*); DENIED requires just the always-required reason.
 */
export function validateResolutionInput(input: ResolutionInput): ResolutionValidationResult {
  if (!input.reason.trim()) {
    return { valid: false, reason: "A reason is required to record a resolution." };
  }
  if (input.resolutionType === "CREDIT" || input.resolutionType === "REFUND") {
    if (input.amount === null || input.amount <= 0) {
      return { valid: false, reason: "A positive amount is required for a credit or refund." };
    }
  }
  if (input.resolutionType === "REPRINT" || input.resolutionType === "EXCHANGE") {
    if (!input.proofGroupId) {
      return {
        valid: false,
        reason: "Select which proof group is being reprinted or exchanged.",
      };
    }
  }
  return { valid: true };
}
