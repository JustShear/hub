import type {
  OrderWarehousePickSummary,
  WarehouseIssueStatus,
  WarehouseIssueType,
  WarehousePickItemStatus,
  WarehousePickJobStatus,
} from "@prisma/client";

// Human-readable labels for the Milestone 13 enums — same convention as
// app/domain/production/labels.ts.

export const WAREHOUSE_PICK_JOB_STATUS_LABELS: Record<WarehousePickJobStatus, string> = {
  QUEUED: "Queued",
  IN_PROGRESS: "In progress",
  HANDED_OVER: "Handed over to packing",
  CANCELLED: "Cancelled",
};

export const WAREHOUSE_PICK_ITEM_STATUS_LABELS: Record<WarehousePickItemStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  PICKED: "Picked",
  SHORT: "Short",
};

export const WAREHOUSE_ISSUE_TYPE_LABELS: Record<WarehouseIssueType, string> = {
  STOCK_SHORTAGE: "Stock shortage",
  DAMAGED_STOCK: "Damaged stock",
  WRONG_LOCATION: "Wrong location",
  MISSING_ITEM: "Missing item",
  OTHER: "Other",
};

export const WAREHOUSE_ISSUE_STATUS_LABELS: Record<WarehouseIssueStatus, string> = {
  OPEN: "Open",
  INVESTIGATING: "Investigating",
  WAITING: "Waiting",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export const ORDER_WAREHOUSE_PICK_SUMMARY_LABELS: Record<OrderWarehousePickSummary, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  HANDED_OVER: "Handed over",
};
