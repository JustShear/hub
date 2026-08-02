import type {
  ExceptionCaseCategory,
  ExceptionCaseInitiator,
  ExceptionCaseStatus,
  ExceptionResolutionStatus,
  ExceptionResolutionType,
} from "@prisma/client";

// Human-readable labels for Milestone 14's enums — same convention as
// app/domain/production/labels.ts and app/domain/warehouse/labels.ts.

export const EXCEPTION_CASE_CATEGORY_LABELS: Record<ExceptionCaseCategory, string> = {
  CUSTOMER_RETURN: "Customer return",
  WARRANTY_CLAIM: "Warranty claim",
  PRODUCTION_DEFECT: "Production defect",
  OTHER: "Other",
};

export const EXCEPTION_CASE_INITIATOR_LABELS: Record<ExceptionCaseInitiator, string> = {
  CUSTOMER: "Customer",
  STAFF: "Staff",
};

export const EXCEPTION_CASE_STATUS_LABELS: Record<ExceptionCaseStatus, string> = {
  OPEN: "Open",
  INVESTIGATING: "Investigating",
  AWAITING_CUSTOMER: "Awaiting customer",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export const EXCEPTION_RESOLUTION_TYPE_LABELS: Record<ExceptionResolutionType, string> = {
  REPRINT: "Reprint",
  CREDIT: "Store credit",
  REFUND: "Refund",
  EXCHANGE: "Exchange",
  DENIED: "Denied",
};

export const EXCEPTION_RESOLUTION_STATUS_LABELS: Record<ExceptionResolutionStatus, string> = {
  PENDING: "Pending",
  COMPLETED: "Completed",
};
