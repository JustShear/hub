import type {
  ColourMode,
  DecorationMethod,
  ExportBatchStatus,
  OrderProductionSummary,
  ProductionArtworkStatus,
  ProductionIssueStatus,
  ProductionIssueType,
  ProductionJobStatus,
  ProductionTaskStatus,
  ProductionTaskType,
} from "@prisma/client";

// Human-readable labels for the Milestone 10 enums — same convention as
// app/domain/proofs/labels.ts and app/domain/orders/labels.ts.

export const PRODUCTION_ARTWORK_STATUS_LABELS: Record<ProductionArtworkStatus, string> = {
  DRAFT: "Draft",
  VALIDATION_FAILED: "Validation failed",
  READY_FOR_EXPORT: "Ready for export",
  EXPORTED: "Exported",
  SUPERSEDED: "Superseded",
  CANCELLED: "Cancelled",
};

export const COLOUR_MODE_LABELS: Record<ColourMode, string> = {
  RGB: "RGB",
  CMYK: "CMYK",
  SPOT: "Spot colour",
  GREYSCALE: "Greyscale",
  UNKNOWN: "Unknown",
};

export const EXPORT_BATCH_STATUS_LABELS: Record<ExportBatchStatus, string> = {
  PREPARING: "Preparing",
  READY: "Ready",
  EXPORTED: "Exported",
  FAILED: "Failed",
  SUPERSEDED: "Superseded",
  CANCELLED: "Cancelled",
};

// Milestone 11 — production queue and workstation workflow.

// The one central place decoration-method-to-workstream naming happens —
// never hardcode this mapping again in a UI component. Deliberately reuses
// the existing 5-value DecorationMethod taxonomy (see ADR-0007) rather than
// a wider, separately-maintained workstream enum.
export const DECORATION_WORKSTREAM_LABELS: Record<DecorationMethod, string> = {
  EMBROIDERY: "Embroidery",
  DIGITAL_PRINT_DTF: "DTF Printing",
  SCREEN_PRINT: "Screen Printing",
  UNPRINTED: "Unprinted Garments",
  OTHER: "External / Other Production",
};

export const PRODUCTION_JOB_STATUS_LABELS: Record<ProductionJobStatus, string> = {
  QUEUED: "Queued",
  READY: "Ready",
  IN_PROGRESS: "In progress",
  PAUSED: "Paused",
  BLOCKED: "Blocked",
  AWAITING_QUALITY_CHECK: "Awaiting quality check",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

export const PRODUCTION_TASK_STATUS_LABELS: Record<ProductionTaskStatus, string> = {
  QUEUED: "Queued",
  READY: "Ready",
  IN_PROGRESS: "In progress",
  PAUSED: "Paused",
  BLOCKED: "Blocked",
  PARTIALLY_COMPLETE: "Partially complete",
  AWAITING_QUALITY_CHECK: "Awaiting quality check",
  COMPLETE: "Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const PRODUCTION_TASK_TYPE_LABELS: Record<ProductionTaskType, string> = {
  PRINT: "Print",
  PRESS: "Heat press",
  EMBROIDER: "Embroider",
  SUBLIMATE: "Sublimate",
  VINYL_APPLY: "Apply vinyl",
  UNPRINTED_PREP: "Prepare unprinted garment",
  EXTERNAL_PRODUCTION: "External production",
  QUALITY_CHECK: "Quality check",
  GENERAL: "Production",
};

export const ORDER_PRODUCTION_SUMMARY_LABELS: Record<OrderProductionSummary, string> = {
  NOT_READY: "Not ready",
  READY_FOR_PRODUCTION: "Ready for production",
  QUEUED: "Queued",
  IN_PROGRESS: "In progress",
  PARTIALLY_COMPLETE: "Partially complete",
  BLOCKED: "Blocked",
  AWAITING_QUALITY_CHECK: "Awaiting quality check",
  COMPLETE: "Complete",
};

export const PRODUCTION_ISSUE_TYPE_LABELS: Record<ProductionIssueType, string> = {
  ARTWORK_PROBLEM: "Artwork problem",
  WRONG_FILE: "Wrong file",
  WRONG_PLACEMENT: "Wrong placement",
  WRONG_COLOUR: "Wrong colour",
  GARMENT_DAMAGE: "Garment damage",
  PRINT_DEFECT: "Print defect",
  EMBROIDERY_DEFECT: "Embroidery defect",
  EQUIPMENT_ISSUE: "Equipment issue",
  STOCK_SHORTAGE: "Stock shortage",
  QUANTITY_DISCREPANCY: "Quantity discrepancy",
  OTHER: "Other",
};

export const PRODUCTION_ISSUE_STATUS_LABELS: Record<ProductionIssueStatus, string> = {
  OPEN: "Open",
  INVESTIGATING: "Investigating",
  WAITING: "Waiting",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

// Pause reasons — a fixed, centralised vocabulary rather than free text
// (except OTHER, which requires accompanying text — see
// validatePauseReason in app/domain/production/pause-reason.ts).
export const PAUSE_REASONS = [
  "WAITING_FOR_STOCK",
  "WAITING_FOR_ARTWORK_CLARIFICATION",
  "MACHINE_ISSUE",
  "STAFF_SHIFT_ENDED",
  "QUALITY_ISSUE",
  "CUSTOMER_CHANGE",
  "EXTERNAL_PRODUCTION_DELAY",
  "OTHER",
] as const;

export type PauseReasonCode = (typeof PAUSE_REASONS)[number];

export const PAUSE_REASON_LABELS: Record<PauseReasonCode, string> = {
  WAITING_FOR_STOCK: "Waiting for stock",
  WAITING_FOR_ARTWORK_CLARIFICATION: "Waiting for artwork clarification",
  MACHINE_ISSUE: "Machine issue",
  STAFF_SHIFT_ENDED: "Staff shift ended",
  QUALITY_ISSUE: "Quality issue",
  CUSTOMER_CHANGE: "Customer change",
  EXTERNAL_PRODUCTION_DELAY: "External production delay",
  OTHER: "Other",
};
