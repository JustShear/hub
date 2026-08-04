import { OrderStatus, type Prisma } from "@prisma/client";

// The Stage One Kanban columns. workflowStatus (OrderStatus) still drives
// the three interactive columns (new/proof_being_prepared/pack); every
// other column is now driven by a Shopify order tag — some tags are applied
// externally (staff tag orders in Shopify directly), some are applied by
// this app itself at the moment it does the corresponding action (see
// sync-order-lifecycle-tag.server.ts and its three call sites). This file
// is still the one place the tag/status → column mapping happens.
export type BoardColumnKey =
  | "new"
  | "order_sheet_printed"
  | "pre_order"
  | "waiting_on_customer"
  | "proof_being_prepared"
  | "proof_sent"
  | "changes_requested"
  | "proof_approved"
  | "exported_for_print"
  | "pack";

// What a drop into an interactive column actually writes. Most interactive
// columns are workflowStatus-driven; Exported for Print is the first
// interactive column whose match condition is a Shopify tag (see the
// RULES comment below) — a drop there syncs that tag instead.
export type DropAction =
  | { type: "workflowStatus"; status: OrderStatus }
  | { type: "shopifyTag"; addTag: string; removeTags: string[] };

export type SpecialViewKey = "on_hold" | "cancelled" | "archived" | "fulfilled";

export const SPECIAL_STATUSES: Record<SpecialViewKey, OrderStatus> = {
  on_hold: OrderStatus.ON_HOLD,
  cancelled: OrderStatus.CANCELLED,
  archived: OrderStatus.ARCHIVED,
  fulfilled: OrderStatus.FULFILLED,
};

export interface BoardOrderLike {
  workflowStatus: OrderStatus;
  tags: string[];
}

export interface BoardColumnDefinition {
  key: BoardColumnKey;
  label: string;
  /** SRS 9.1's purpose text — shown as the column's accessible description. */
  purpose: string;
  /** Can a card be dropped INTO this column? */
  interactive: boolean;
  /** What a drop into this column writes. Only present when interactive. */
  dropAction?: DropAction;
  /** Shown in the UI (tooltip / Move-to menu) when interactive is false. */
  readOnlyReason?: string;
  /** Pure predicate — provably in sync with `where` below (both derived from the same rule, see deriveColumns). */
  matches: (order: BoardOrderLike) => boolean;
  /** Prisma where-fragment for querying this column directly (used by "load more" and column-scoped queries). */
  where: Prisma.ShopifyOrderWhereInput;
}

interface RawColumnRule {
  key: BoardColumnKey;
  label: string;
  purpose: string;
  interactive: boolean;
  dropAction?: DropAction;
  readOnlyReason?: string;
  /** Lower number = checked first / more-advanced-wins. Independent of BOARD_COLUMNS' own (display) order below. */
  matchPriority: number;
  ownMatches: (order: BoardOrderLike) => boolean;
  ownWhere: Prisma.ShopifyOrderWhereInput;
}

const PACK_STATUSES = [OrderStatus.READY_TO_PACK, OrderStatus.PACKING] as const;

// WAITING_CUSTOMER is folded into proof_being_prepared rather than left to
// fall through to "new" — once the old interactive "Waiting on Customer"
// drop target is removed, nothing will ever set that value again, but any
// order already sitting there is more honestly "still being worked on
// internally" than "brand new."
const PROOF_BEING_PREPARED_STATUSES = [
  OrderStatus.ARTWORK_REQUIRED,
  OrderStatus.PROOFING_IN_PROGRESS,
  OrderStatus.WAITING_CUSTOMER,
] as const;

// Raw rules, one per column, in match-priority order (most-advanced-state
// wins). This is intentionally NOT the display order used to render the
// board — see BOARD_COLUMNS below, which reorders these for display while
// reusing the exact same derived matches/where.
const RULES: RawColumnRule[] = [
  {
    key: "pack",
    label: "Pack",
    purpose: "Ready to pack — create a freight label directly from the card.",
    interactive: true,
    dropAction: { type: "workflowStatus", status: OrderStatus.READY_TO_PACK },
    matchPriority: 1,
    ownMatches: (order) => (PACK_STATUSES as readonly OrderStatus[]).includes(order.workflowStatus),
    ownWhere: { workflowStatus: { in: [...PACK_STATUSES] } },
  },
  {
    key: "exported_for_print",
    label: "Exported for Print",
    purpose: "Approved artwork has been exported for production.",
    // Interactive as well as tag-driven: still matches purely off the real
    // Shopify tag (so an order tagged "Exported for Print" directly in
    // Shopify — or automatically, via createExportBatch — always lands
    // here regardless of source), but a manual drop now also syncs that
    // same tag to Shopify, rather than being read-only like the other
    // tag-driven columns. Deliberately add-only (no removeTags) — the
    // shop wants prior lifecycle tags left on the order in Shopify; this
    // column's own match priority already outranks proof_sent/rejected/
    // accepted, so leaving them in place never affects board placement.
    interactive: true,
    dropAction: {
      type: "shopifyTag",
      addTag: "Exported for Print",
      removeTags: [],
    },
    matchPriority: 2,
    ownMatches: (order) => order.tags.includes("Exported for Print"),
    ownWhere: { tags: { has: "Exported for Print" } },
  },
  {
    key: "proof_approved",
    label: "Proof Approved",
    purpose: "Customer approved the proof.",
    interactive: false,
    readOnlyReason: "Set automatically when a customer response is recorded — not manually draggable.",
    matchPriority: 3,
    ownMatches: (order) => order.tags.includes("proof_accepted"),
    ownWhere: { tags: { has: "proof_accepted" } },
  },
  {
    key: "changes_requested",
    label: "Changes Requested",
    purpose: "Customer has requested a revision.",
    interactive: false,
    readOnlyReason: "Set automatically when a customer response is recorded — not manually draggable.",
    matchPriority: 4,
    ownMatches: (order) => order.tags.includes("proof_rejected"),
    ownWhere: { tags: { has: "proof_rejected" } },
  },
  {
    key: "proof_sent",
    label: "Proof Sent",
    purpose: "Customer response is pending.",
    interactive: false,
    readOnlyReason: "Set automatically when Just Shear sends a proof request — not manually draggable.",
    matchPriority: 5,
    ownMatches: (order) => order.tags.includes("proof_sent"),
    ownWhere: { tags: { has: "proof_sent" } },
  },
  {
    key: "waiting_on_customer",
    label: "Waiting on Customer",
    purpose: 'Staff have contacted the customer and are waiting on a reply (tagged "emailed" in Shopify).',
    // Interactive as well as tag-driven, same precedent as Exported for
    // Print: still matches purely off the real Shopify "emailed" tag (so an
    // order tagged directly in Shopify still lands here), but a manual drop
    // now also syncs that tag, for staff who've just contacted the customer
    // outside of Shopify (a phone call, in person) and want the board to
    // reflect that immediately rather than waiting on a separate Shopify
    // tagging step. Add-only (no removeTags) — this column's match priority
    // already outranks order_sheet_printed/proof_being_prepared/new, so
    // leftover lower-priority tags never affect placement.
    interactive: true,
    dropAction: { type: "shopifyTag", addTag: "emailed", removeTags: [] },
    matchPriority: 6,
    ownMatches: (order) => order.tags.includes("emailed"),
    ownWhere: { tags: { has: "emailed" } },
  },
  {
    key: "order_sheet_printed",
    label: "Order Sheet Printed",
    purpose: 'Order sheet printed (tagged "p" in Shopify).',
    interactive: false,
    readOnlyReason:
      'Set from the "p" Shopify tag, applied by staff in Shopify — not draggable here.',
    matchPriority: 7,
    ownMatches: (order) => order.tags.includes("p"),
    ownWhere: { tags: { has: "p" } },
  },
  {
    key: "proof_being_prepared",
    label: "Proof Being Prepared",
    purpose: "Artwork work has started.",
    interactive: true,
    dropAction: { type: "workflowStatus", status: OrderStatus.PROOFING_IN_PROGRESS },
    matchPriority: 8,
    ownMatches: (order) =>
      (PROOF_BEING_PREPARED_STATUSES as readonly OrderStatus[]).includes(order.workflowStatus),
    ownWhere: { workflowStatus: { in: [...PROOF_BEING_PREPARED_STATUSES] } },
  },
  {
    key: "pre_order",
    label: "Pre-Order",
    purpose: "Known/paid orders held back until their production window opens.",
    interactive: true,
    dropAction: { type: "workflowStatus", status: OrderStatus.PRE_ORDER },
    // Priority sits just above New: any real progress (a tag, or dragging
    // into Proof Being Prepared/Pack) naturally graduates an order out of
    // Pre-Order without staff needing to drag it out first, since those
    // rules all outrank this one and the order's workflowStatus changes
    // the moment it's dragged anywhere else.
    matchPriority: 9,
    ownMatches: (order) => order.workflowStatus === OrderStatus.PRE_ORDER,
    ownWhere: { workflowStatus: OrderStatus.PRE_ORDER },
  },
  {
    key: "new",
    label: "New",
    purpose: "Imported orders awaiting review.",
    interactive: true,
    dropAction: { type: "workflowStatus", status: OrderStatus.NEW },
    // The structural catch-all — an order lands here either because it's
    // genuinely brand-new, or because nothing more specific claimed it.
    matchPriority: 10,
    ownMatches: () => true,
    ownWhere: {},
  },
];

// Derives matches()/where by folding in "AND NOT any higher-priority rule's
// own condition" automatically, so the two can never silently drift apart
// the way two independently hand-maintained exclusion lists could — a real
// risk once tags (which can coexist on one order, unlike a single-valued
// workflowStatus) drive most columns.
function deriveColumns(rules: RawColumnRule[]): BoardColumnDefinition[] {
  const byPriority = [...rules].sort((a, b) => a.matchPriority - b.matchPriority);
  return rules.map((rule) => {
    const higherPriority = byPriority.filter((r) => r.matchPriority < rule.matchPriority);
    return {
      key: rule.key,
      label: rule.label,
      purpose: rule.purpose,
      interactive: rule.interactive,
      dropAction: rule.dropAction,
      readOnlyReason: rule.readOnlyReason,
      matches: (order: BoardOrderLike) =>
        rule.ownMatches(order) && !higherPriority.some((h) => h.ownMatches(order)),
      where: {
        AND: [rule.ownWhere, ...higherPriority.map((h) => ({ NOT: h.ownWhere }))],
      },
    };
  });
}

const DERIVED_BY_KEY = new Map(deriveColumns(RULES).map((column) => [column.key, column]));

function columnFor(key: BoardColumnKey): BoardColumnDefinition {
  const column = DERIVED_BY_KEY.get(key);
  if (!column) {
    throw new Error(`Unknown board column: ${key}`);
  }
  return column;
}

// Kept in DISPLAY order (left to right on the board) — distinct from the
// match-priority order in RULES above. MoveToMenu, board-query.server.ts,
// and every test iterate this array directly.
export const BOARD_COLUMNS: BoardColumnDefinition[] = [
  columnFor("new"),
  columnFor("order_sheet_printed"),
  columnFor("pre_order"),
  columnFor("waiting_on_customer"),
  columnFor("proof_being_prepared"),
  columnFor("proof_sent"),
  columnFor("changes_requested"),
  columnFor("proof_approved"),
  columnFor("exported_for_print"),
  columnFor("pack"),
];

export function isSpecialStatus(status: OrderStatus): boolean {
  return Object.values(SPECIAL_STATUSES).includes(status);
}

/** Returns null for orders on hold, cancelled, archived, or fulfilled — those never appear on the main board. */
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
