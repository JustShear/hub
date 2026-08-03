import type { DueDateType, OrderProofSummary, OrderStatus, Priority } from "@prisma/client";
import type { DueDateState } from "~/lib/dates";

// Human-readable labels for enum values shown on the board — kept separate
// from the enums themselves so "stable internal enum values" (never
// human-readable strings) stay the actual business identifiers everywhere
// else (DB, transition policy, filters).

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "New",
  PRE_ORDER: "Pre-order",
  ARTWORK_REQUIRED: "Artwork required",
  PROOFING_IN_PROGRESS: "Proofing in progress",
  WAITING_CUSTOMER: "Waiting on customer",
  PARTIALLY_APPROVED: "Partially approved",
  READY_FOR_EXPORT: "Ready for export",
  PARTIALLY_EXPORTED: "Partially exported",
  EXPORTED_FOR_PRINT: "Exported for print",
  IN_PRODUCTION: "In production",
  PARTIALLY_COMPLETE: "Partially complete",
  READY_TO_PACK: "Ready to pack",
  PACKING: "Packing",
  FULFILLED: "Fulfilled",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

// Honest, staff-facing wording — never invents a status like "proof sent"
// when what actually happened is "no proof has been sent yet".
export const PROOF_SUMMARY_LABELS: Record<OrderProofSummary, string> = {
  NO_PROOFS_REQUIRED: "No proof required",
  PROOFS_NOT_STARTED: "Proofs not started",
  PROOFS_IN_PROGRESS: "Proofs in progress",
  READY_TO_SEND: "Ready to send",
  WAITING_ON_CUSTOMER: "Waiting for customer",
  CHANGES_REQUESTED: "Changes requested",
  PARTIALLY_APPROVED: "Partially approved",
  ALL_REQUIRED_PROOFS_APPROVED: "All proofs approved",
  PARTIALLY_EXPORTED: "Partially exported",
  ALL_REQUIRED_PROOFS_EXPORTED: "All proofs exported",
  BLOCKED: "Blocked",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

export const DUE_DATE_TYPE_LABELS: Record<DueDateType, string> = {
  INTERNAL: "Internal",
  CUSTOMER_PROMISED: "Customer-promised",
  PRODUCTION: "Production",
  DISPATCH: "Dispatch",
};

export const DUE_DATE_STATE_LABELS: Record<DueDateState, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  due_soon: "Due soon",
  future: "Due",
  none: "No due date",
};
