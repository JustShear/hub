import { OrderStatus, OrderProofSummary, type Prisma } from "@prisma/client";

// The Stage One Kanban columns per SRS Section 9.1. workflowStatus
// (OrderStatus) is the core status model and has more values (16) than
// there are columns (7) — this file is the one place that mapping happens,
// rather than replacing OrderStatus or duplicating this logic per call site.
export type BoardColumnKey =
  | "changes_requested"
  | "proof_sent"
  | "new"
  | "proof_being_prepared"
  | "waiting_on_customer"
  | "proof_approved"
  | "exported_for_print";

export type SpecialViewKey = "on_hold" | "cancelled" | "archived";

export const SPECIAL_STATUSES: Record<SpecialViewKey, OrderStatus> = {
  on_hold: OrderStatus.ON_HOLD,
  cancelled: OrderStatus.CANCELLED,
  archived: OrderStatus.ARCHIVED,
};

export interface BoardOrderLike {
  workflowStatus: OrderStatus;
  proofSummary: OrderProofSummary;
}

export interface BoardColumnDefinition {
  key: BoardColumnKey;
  label: string;
  /** SRS 9.1's purpose text — shown as the column's accessible description. */
  purpose: string;
  /** Can a card be dropped INTO this column? */
  interactive: boolean;
  /** The workflowStatus value a drop into this column sets. Only present when interactive. */
  dropSetsWorkflowStatus?: OrderStatus;
  /** Shown in the UI (tooltip / Move-to menu) when interactive is false. */
  readOnlyReason?: string;
  /** Pure predicate — must stay logically equivalent to `where` below. */
  matches: (order: BoardOrderLike) => boolean;
  /** Prisma where-fragment for querying this column directly (used by "load more" and column-scoped queries). */
  where: Prisma.ShopifyOrderWhereInput;
}

const PROOF_BEING_PREPARED_STATUSES = [
  OrderStatus.ARTWORK_REQUIRED,
  OrderStatus.PROOFING_IN_PROGRESS,
] as const;

const PROOF_APPROVED_STATUSES = [
  OrderStatus.PARTIALLY_APPROVED,
  OrderStatus.READY_FOR_EXPORT,
] as const;

// Catch-all for everything from EXPORTED_FOR_PRINT through FULFILLED — there
// is no dedicated production/warehouse/packing screen yet (Milestones 7+),
// so an order that has moved past active proofing stays visible here rather
// than disappearing from the board entirely. Revisit once those screens exist.
const EXPORTED_STATUSES = [
  OrderStatus.PARTIALLY_EXPORTED,
  OrderStatus.EXPORTED_FOR_PRINT,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.PARTIALLY_COMPLETE,
  OrderStatus.READY_TO_PACK,
  OrderStatus.PACKING,
  OrderStatus.FULFILLED,
] as const;

// Priority order matters: this array is scanned top-to-bottom by
// getBoardColumnKey, and the FIRST matching column wins. "Changes Requested"
// and "Proof Sent" have no distinct OrderStatus value of their own — OrderStatus
// doesn't distinguish "sent, awaiting response" or "customer asked for a
// revision" from the surrounding proofing states — so they're promoted
// ahead of everything else based on proofSummary (OrderProofSummary), which
// does track that nuance. Once proof-group creation and customer responses
// ship (later milestones), real data will populate these; until then they'll
// simply stay empty, which is honest given no proof groups exist yet.
export const BOARD_COLUMNS: BoardColumnDefinition[] = [
  {
    key: "changes_requested",
    label: "Changes Requested",
    purpose: "Customer has requested a revision.",
    interactive: false,
    readOnlyReason:
      "Set automatically once customer proof responses exist (a later milestone) — not manually draggable.",
    matches: (order) => order.proofSummary === OrderProofSummary.CHANGES_REQUESTED,
    where: { proofSummary: OrderProofSummary.CHANGES_REQUESTED },
  },
  {
    key: "proof_sent",
    label: "Proof Sent",
    purpose: "Customer response is pending.",
    interactive: false,
    readOnlyReason:
      "Set automatically once proof sending exists (a later milestone) — not manually draggable.",
    matches: (order) => order.proofSummary === OrderProofSummary.WAITING_ON_CUSTOMER,
    where: { proofSummary: OrderProofSummary.WAITING_ON_CUSTOMER },
  },
  {
    key: "new",
    label: "New",
    purpose: "Imported orders awaiting review.",
    interactive: true,
    dropSetsWorkflowStatus: OrderStatus.NEW,
    matches: (order) => order.workflowStatus === OrderStatus.NEW,
    where: { workflowStatus: OrderStatus.NEW },
  },
  {
    key: "proof_being_prepared",
    label: "Proof Being Prepared",
    purpose: "Artwork work has started.",
    interactive: true,
    dropSetsWorkflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
    matches: (order) =>
      (PROOF_BEING_PREPARED_STATUSES as readonly OrderStatus[]).includes(order.workflowStatus),
    where: { workflowStatus: { in: [...PROOF_BEING_PREPARED_STATUSES] } },
  },
  {
    key: "waiting_on_customer",
    label: "Waiting on Customer",
    purpose: "Staff are waiting for information or artwork.",
    interactive: true,
    dropSetsWorkflowStatus: OrderStatus.WAITING_CUSTOMER,
    matches: (order) => order.workflowStatus === OrderStatus.WAITING_CUSTOMER,
    where: { workflowStatus: OrderStatus.WAITING_CUSTOMER },
  },
  {
    key: "proof_approved",
    label: "Proof Approved",
    purpose: "At least one relevant group is approved and awaiting export.",
    interactive: true,
    dropSetsWorkflowStatus: OrderStatus.READY_FOR_EXPORT,
    matches: (order) =>
      (PROOF_APPROVED_STATUSES as readonly OrderStatus[]).includes(order.workflowStatus),
    where: { workflowStatus: { in: [...PROOF_APPROVED_STATUSES] } },
  },
  {
    key: "exported_for_print",
    label: "Exported for Print",
    purpose: "Approved artwork has been converted to production files.",
    interactive: false,
    readOnlyReason:
      "Only reachable via the dedicated export action once proof approval/export records exist (a later milestone) — not manually draggable.",
    matches: (order) =>
      (EXPORTED_STATUSES as readonly OrderStatus[]).includes(order.workflowStatus),
    where: { workflowStatus: { in: [...EXPORTED_STATUSES] } },
  },
];

export function isSpecialStatus(status: OrderStatus): boolean {
  return Object.values(SPECIAL_STATUSES).includes(status);
}

/** Returns null for orders on hold, cancelled, or archived — those never appear on the main board. */
export function getBoardColumnKey(order: BoardOrderLike): BoardColumnKey | null {
  if (isSpecialStatus(order.workflowStatus)) {
    return null;
  }
  return BOARD_COLUMNS.find((column) => column.matches(order))?.key ?? null;
}

export function getBoardColumn(key: BoardColumnKey): BoardColumnDefinition {
  const column = BOARD_COLUMNS.find((c) => c.key === key);
  if (!column) {
    throw new Error(`Unknown board column: ${key}`);
  }
  return column;
}

export function getInteractiveColumnKeys(): BoardColumnKey[] {
  return BOARD_COLUMNS.filter((column) => column.interactive).map((column) => column.key);
}
