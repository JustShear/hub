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
 * movement, see ADR-0010). REPRINT/EXCHANGE/DENIED just require the
 * always-required reason — REPRINT/EXCHANGE used to also require a proof
 * group to re-export via createExportBatch, but that mechanism was removed
 * (see docs/decisions on removing Production Artwork); the proofGroupId
 * field is accepted but no longer enforced or acted on.
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
  return { valid: true };
}
