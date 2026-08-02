import type {
  DecorationMethod,
  NoProofReason,
  ProofGroupStatus,
  ProofRequirementValue,
  ProofVersionStatus,
} from "@prisma/client";

// Human-readable labels for the proof-domain enums — kept separate from the
// enums themselves, same convention as app/domain/orders/labels.ts.

export const DECORATION_METHOD_LABELS: Record<DecorationMethod, string> = {
  EMBROIDERY: "Embroidery",
  DIGITAL_PRINT_DTF: "Digital print (DTF)",
  SCREEN_PRINT: "Screen print",
  UNPRINTED: "Unprinted",
  OTHER: "Other",
};

// Milestone 08's own vocabulary (UNDETERMINED/PROOF_REQUIRED/NO_PROOF_REQUIRED)
// maps onto the schema's pre-existing ProofRequirementValue enum
// (UNDETERMINED/REQUIRED/NOT_REQUIRED/PARTIALLY_REQUIRED) rather than
// renaming it — PARTIALLY_REQUIRED exists for a future milestone and is
// never set by anything built here, but stays labelled for honesty if it's
// ever seen.
export const PROOF_REQUIREMENT_VALUE_LABELS: Record<ProofRequirementValue, string> = {
  UNDETERMINED: "Not yet decided",
  REQUIRED: "Proof required",
  NOT_REQUIRED: "No proof required",
  PARTIALLY_REQUIRED: "Partially required",
};

export const NO_PROOF_REASON_LABELS: Record<NoProofReason, string> = {
  UNPRINTED_PRODUCT: "Unprinted product",
  REPEAT_JOB_PREVIOUS_ARTWORK: "Repeat job (previous artwork)",
  APPROVED_STANDARD_LOGO: "Standard approved logo",
  CUSTOMER_SUPPLIED_PRODUCTION_READY: "Customer-supplied production-ready artwork",
  INTERNAL_STAFF_ORDER: "Internal order",
  OTHER: "Other",
};

// Full enum label set (all 11 values), even though this milestone only ever
// writes the "actively supported" subset — the rest exist so the UI can
// still render historical/future data honestly if it's ever present,
// without needing a separate label table added later.
export const PROOF_GROUP_STATUS_LABELS: Record<ProofGroupStatus, string> = {
  NOT_STARTED: "Not started",
  DRAFT_IN_PROGRESS: "Draft in progress",
  READY_TO_SEND: "Ready to send",
  SENT: "Sent",
  VIEWED: "Viewed",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  NO_PROOF_REQUIRED: "No proof required",
  READY_FOR_EXPORT: "Ready for export",
  EXPORTED_FOR_PRINT: "Exported for print",
  CANCELLED: "Cancelled",
};

export const PROOF_VERSION_STATUS_LABELS: Record<ProofVersionStatus, string> = {
  DRAFT: "Draft",
  READY_TO_SEND: "Ready to send",
  SENT: "Sent",
  VIEWED: "Viewed",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  SUPERSEDED: "Superseded",
  CANCELLED: "Cancelled",
};

// The subset of each status enum this milestone's server actions are ever
// allowed to write — used as the TypeScript type for every mutation input,
// so setting a later-milestone status (SENT, APPROVED, etc.) is a compile
// error here, not just a runtime guard.
export type ActiveProofGroupStatus =
  "NOT_STARTED" | "DRAFT_IN_PROGRESS" | "READY_TO_SEND" | "NO_PROOF_REQUIRED" | "CANCELLED";

export type ActiveProofVersionStatus = "DRAFT" | "READY_TO_SEND" | "SUPERSEDED" | "CANCELLED";

// Milestone 09 — the exact wording a customer confirms before a proof group
// can be approved. Versioned (not just the string alone) so that if this
// wording is ever changed, a stored acknowledgedVersion on a past
// CustomerProofResponse still says exactly what was agreed to at the time,
// rather than being silently reinterpreted against new wording.
export const PROOF_APPROVAL_ACKNOWLEDGEMENT_VERSION = "v1";
export const PROOF_APPROVAL_ACKNOWLEDGEMENT_TEXT =
  "I have reviewed this proof and approve it for production.";
