import type {
  DecorationMethod,
  NoProofReason,
  OrderStatus,
  ProofGroupStatus,
} from "@prisma/client";

// Pure eligibility rules for Milestone 10 — no DB access, so the server
// action and the UI (to explain why a button is disabled) call the exact
// same logic. Server-side validation inside the transaction is always the
// real guard; this is the shared source of truth for what it checks.
//
// A proof group becomes export-eligible one of exactly two ways per the
// SRS: the EXACT proof version the group is currently on has been
// customer-approved, or the group is legitimately NO_PROOF_REQUIRED with a
// complete, documented reason. There is no third path.

export type ProductionArtworkEligibilityPath = "approved_version" | "no_proof_required";

export interface ProductionArtworkEligibilityInput {
  orderStatus: OrderStatus;
  proofGroupStatus: ProofGroupStatus;
  noProofReason: NoProofReason | null;
  /** The group's current (latest, non-superseded, non-cancelled) proof version, if any. */
  currentVersion: { id: string; status: string } | null;
}

export interface EligibilityResult {
  eligible: boolean;
  path: ProductionArtworkEligibilityPath | null;
  reasons: string[];
}

const GROUP_STATUSES_ELIGIBLE_FOR_NEW_ARTWORK: ReadonlySet<ProofGroupStatus> = new Set([
  "APPROVED",
  "NO_PROOF_REQUIRED",
  "READY_FOR_EXPORT",
  "EXPORTED_FOR_PRINT",
] as ProofGroupStatus[]);

/**
 * Can staff start a new production artwork revision for this group right
 * now? `READY_FOR_EXPORT`/`EXPORTED_FOR_PRINT` are included because
 * preparing a superseding revision (e.g. a correction after export) starts
 * from the same underlying approved/no-proof-required state that got the
 * group there in the first place.
 */
export function evaluateProductionArtworkEligibility(
  input: ProductionArtworkEligibilityInput,
): EligibilityResult {
  const reasons: string[] = [];

  if (input.orderStatus === "CANCELLED") {
    reasons.push("This order is cancelled and can't have production artwork prepared for it.");
  }

  if (!GROUP_STATUSES_ELIGIBLE_FOR_NEW_ARTWORK.has(input.proofGroupStatus)) {
    reasons.push(
      "This proof group must be customer-approved or marked no-proof-required before production artwork can be prepared.",
    );
    return { eligible: false, path: null, reasons };
  }

  const isNoProofPath = input.proofGroupStatus === "NO_PROOF_REQUIRED";
  if (isNoProofPath) {
    if (!input.noProofReason) {
      reasons.push("This group's no-proof-required decision is missing its documented reason.");
      return { eligible: false, path: null, reasons };
    }
    return { eligible: reasons.length === 0, path: "no_proof_required", reasons };
  }

  // Approved-version path (also covers READY_FOR_EXPORT/EXPORTED_FOR_PRINT
  // groups whose original path was an approval).
  if (input.currentVersion?.status !== "APPROVED") {
    reasons.push(
      "This group's current proof version is no longer approved — it may have been reopened or superseded since.",
    );
    return { eligible: false, path: null, reasons };
  }

  return { eligible: reasons.length === 0, path: "approved_version", reasons };
}

export interface ReadyForExportInput {
  artworkStatus:
    "DRAFT" | "VALIDATION_FAILED" | "READY_FOR_EXPORT" | "EXPORTED" | "SUPERSEDED" | "CANCELLED";
  validationStatus: boolean;
  hasStoredFile: boolean;
  allocatedLineCount: number;
}

/** Can this specific production artwork revision be marked ready for export? */
export function evaluateReadyForExportEligibility(input: ReadyForExportInput): EligibilityResult {
  const reasons: string[] = [];

  if (input.artworkStatus === "CANCELLED") {
    reasons.push("This production artwork revision is cancelled.");
  } else if (input.artworkStatus === "SUPERSEDED") {
    reasons.push("This production artwork revision has already been superseded.");
  } else if (input.artworkStatus === "EXPORTED") {
    reasons.push("This production artwork revision has already been exported.");
  }

  if (!input.hasStoredFile) {
    reasons.push("This production artwork revision has no uploaded file yet.");
  }
  if (!input.validationStatus) {
    reasons.push("This production artwork revision has not passed validation.");
  }
  if (input.allocatedLineCount === 0) {
    reasons.push("At least one order line must be allocated to this production artwork.");
  }

  return { eligible: reasons.length === 0, path: null, reasons };
}

export interface ProductionArtworkMetadataInput {
  decorationMethod: DecorationMethod;
  placement: string | null;
}

export interface ValidationResult {
  passed: boolean;
  messages: string[];
}

/**
 * Deliberately narrow: the one rule the domain has real confidence about
 * (placement is meaningless — and required — the same way it is for a proof
 * group, see app/domain/proofs/readiness.ts). Never rejects a file for
 * dimension/colour-mode/resolution reasons it can't actually verify — those
 * are surfaced to staff as informational metadata, not validation failures.
 */
export function validateProductionArtworkMetadata(
  input: ProductionArtworkMetadataInput,
): ValidationResult {
  const messages: string[] = [];
  if (input.decorationMethod !== "UNPRINTED" && !(input.placement ?? "").trim()) {
    messages.push("Placement is required for this decoration method.");
  }
  return { passed: messages.length === 0, messages };
}

export interface ExportBatchItemEligibilityInput {
  orderStatus: OrderStatus;
  proofGroupStatus: ProofGroupStatus;
  artworkStatus:
    "DRAFT" | "VALIDATION_FAILED" | "READY_FOR_EXPORT" | "EXPORTED" | "SUPERSEDED" | "CANCELLED";
  /** True if a sourceProofVersionId is set and that exact version's status is still APPROVED right now. */
  sourceVersionStillApproved: boolean | null;
}

/** Can this group's current READY_FOR_EXPORT artwork actually be included in an export batch right now? */
export function evaluateExportBatchItemEligibility(
  input: ExportBatchItemEligibilityInput,
): EligibilityResult {
  const reasons: string[] = [];

  if (input.orderStatus === "CANCELLED") {
    reasons.push("This order is cancelled and can't be exported.");
  }
  if (input.artworkStatus !== "READY_FOR_EXPORT") {
    reasons.push("This group's production artwork is not marked ready for export.");
  }
  if (
    input.proofGroupStatus !== "READY_FOR_EXPORT" &&
    input.proofGroupStatus !== "APPROVED" &&
    input.proofGroupStatus !== "NO_PROOF_REQUIRED"
  ) {
    reasons.push("This proof group is no longer in an export-eligible state.");
  }
  if (input.sourceVersionStillApproved === false) {
    reasons.push(
      "The proof version this artwork was prepared from is no longer approved — it may have been reopened since.",
    );
  }

  return { eligible: reasons.length === 0, path: null, reasons };
}
