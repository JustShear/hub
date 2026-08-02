import {
  OrderStatus,
  OrderProofSummary,
  type AssignmentRole,
  type DueDateType,
  type OrderProductionSummary,
  type OrderWarehousePickSummary,
  type Priority,
  type ProductionIssueStatus,
  type Severity,
  type Prisma,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import { OPEN_STATUSES } from "~/domain/integrations/record-failure.server";
import { classifyDueDate, daysSince, type DueDateState } from "~/lib/dates";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";
import {
  summarizeProofGroupsForBoard,
  type BoardProofSummary,
} from "~/domain/proofs/board-summary";
import {
  BOARD_COLUMNS,
  getBoardColumn,
  getBoardColumnKey,
  SPECIAL_STATUSES,
  type BoardColumnKey,
  type SpecialViewKey,
} from "~/domain/orders/board-columns";
import {
  usesCursorPagination,
  type BoardFilters,
  type BoardSort,
  type SortField,
} from "~/domain/orders/board-filters";

// Bounds how much the board ever loads in one round trip — see
// docs/development.md "Kanban board" for the reasoning and expected
// behaviour at 100/500/1000+ active orders.
const PER_COLUMN_LIMIT = 40;
const LOAD_MORE_PAGE_SIZE = 40;
// Sorts that need a computed field (nearest due date, or the composite
// default) can't be expressed as a single indexed ORDER BY, so "load more"
// for them falls back to bounded offset pagination instead of a true
// cursor — this cap stops that path from ever full-scanning the table.
const MAX_OFFSET_PAGINATION_ROWS = 500;

const SPECIAL_STATUS_VALUES = Object.values(SPECIAL_STATUSES);

const ASSIGNMENT_ROLE_PRIORITY: AssignmentRole[] = [
  "OWNER",
  "ARTWORK",
  "GENERAL",
  "PRODUCTION",
  "PACKING",
];

const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };

const BOARD_CARD_SELECT = {
  id: true,
  orderNumber: true,
  customerName: true,
  customerEmail: true,
  shopifyCreatedAt: true,
  workflowStatus: true,
  workflowStatusChangedAt: true,
  proofSummary: true,
  productionSummary: true,
  warehousePickSummary: true,
  priority: true,
  tags: true,
  isPreorder: true,
  cancelledAt: true,
  lines: {
    take: 6,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      productTitle: true,
      variantTitle: true,
      quantity: true,
      imageUrl: true,
      sku: true,
    },
  },
  _count: { select: { lines: true, proofGroups: true } },
  proofGroups: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      assignedStaffId: true,
      versions: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: {
          assets: { where: { isPrimary: true }, take: 1, select: { id: true, mimeType: true } },
        },
      },
    },
  },
  dueDates: { select: { type: true, dueDate: true } },
  assignments: {
    where: { unassignedAt: null },
    select: { role: true, staffUserId: true, staffUser: { select: { name: true } } },
  },
  integrationFailures: {
    where: { status: { in: OPEN_STATUSES } },
    take: 3,
    select: { id: true, severity: true, summary: true },
  },
} satisfies Prisma.ShopifyOrderSelect;

type BoardOrderRow = Prisma.ShopifyOrderGetPayload<{ select: typeof BOARD_CARD_SELECT }>;

export interface BoardCardProductLine {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  imageUrl: string | null;
  sku: string | null;
}

export interface BoardCardAssignment {
  role: AssignmentRole;
  staffUserId: string;
  staffUserName: string;
}

export interface BoardCardIntegrationIssue {
  id: string;
  severity: Severity;
  summary: string;
}

export interface BoardCardDueDate {
  type: DueDateType;
  dueDate: string;
  state: DueDateState;
}

export interface BoardCardProofSummary extends BoardProofSummary {
  latestThumbnail: { assetId: string; mimeType: string | null } | null;
  assignedStaffNames: string[];
}

export interface BoardCard {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string | null;
  shopifyCreatedAt: string;
  workflowStatus: OrderStatus;
  workflowStatusChangedAt: string;
  daysInState: number;
  proofSummary: OrderProofSummary;
  priority: Priority;
  tags: string[];
  isPreorder: boolean;
  isWaitingOnCustomer: boolean;
  hasCustomerResponseAlert: boolean;
  /** True for workflowStatus PARTIALLY_APPROVED/READY_FOR_EXPORT — approved but not yet exported. */
  isApprovedNotExported: boolean;
  /** An open EMAIL-integration failure exists for this order (Milestone 09) — a proof-request email failed to send. */
  hasFailedProofDelivery: boolean;
  /** At least one APPROVED/NO_PROOF_REQUIRED group has no production artwork prepared yet (Milestone 10). */
  hasMissingProductionArtwork: boolean;
  /** At least one READY_FOR_EXPORT group was previously exported and now needs a fresh export run (Milestone 10). */
  hasReexportRequired: boolean;
  /** Rolled up from all non-cancelled production tasks across all non-cancelled jobs (Milestone 11) — never hand-set. */
  productionSummary: OrderProductionSummary;
  /** An open (non-resolved/cancelled) ProductionIssue exists somewhere on this order (Milestone 11). */
  hasOpenProductionIssue: boolean;
  /** The order-level PRODUCTION-role assignee, if any — distinct from a specific job/task's own assignee (Milestone 11). */
  productionAssignedStaffName: string | null;
  /** A non-cancelled/non-failed FreightShipment exists for this order (Milestone 12). */
  hasActiveFreightShipment: boolean;
  /** The tracking number of the most recent CREATED shipment, if any (Milestone 12). */
  freightTrackingNumber: string | null;
  /** Full active-shipment shape for the inline Pack-column freight controls, if one exists. */
  freightShipment: BoardCardFreightShipment | null;
  /** ShopifyOrder.cancelledAt !== null — distinct from workflowStatus === CANCELLED, since a Shopify-cancelled order's workflowStatus isn't forced to move. */
  isCancelled: boolean;
  /** Rolled up from the order's WarehousePickJob (Milestone 13) — never hand-set. */
  warehousePickSummary: OrderWarehousePickSummary;
  /** An open (non-resolved/cancelled) WarehouseIssue exists somewhere on this order (Milestone 13). */
  hasOpenWarehouseIssue: boolean;
  /** At least one WarehousePickItem on this order's pick job is SHORT (Milestone 13). */
  hasShortPickItems: boolean;
  /** An open (non-resolved/cancelled) ExceptionCase exists somewhere on this order (Milestone 14). */
  hasOpenExceptionCase: boolean;
  /** Null only for special-view (on hold / cancelled / archived) cards. */
  columnKey: BoardColumnKey | null;
  lines: BoardCardProductLine[];
  lineCount: number;
  proofGroupCount: number;
  proofGroupSummary: BoardCardProofSummary;
  assignment: BoardCardAssignment | null;
  nearestDueDate: BoardCardDueDate | null;
  integrationIssues: BoardCardIntegrationIssue[];
  hasIntegrationIssue: boolean;
}

export interface BoardColumnResult {
  key: BoardColumnKey;
  label: string;
  purpose: string;
  interactive: boolean;
  readOnlyReason?: string;
  cards: BoardCard[];
  hasMore: boolean;
}

function pickNearestDueDate(
  dueDates: { type: DueDateType; dueDate: Date }[],
  now: Date,
): BoardCardDueDate | null {
  if (dueDates.length === 0) return null;
  const nearest = dueDates.reduce((closest, current) =>
    current.dueDate < closest.dueDate ? current : closest,
  );
  return {
    type: nearest.type,
    dueDate: nearest.dueDate.toISOString(),
    state: classifyDueDate(nearest.dueDate, now),
  };
}

function pickPrimaryAssignment(
  assignments: { role: AssignmentRole; staffUserId: string; staffUser: { name: string } }[],
): BoardCardAssignment | null {
  if (assignments.length === 0) return null;
  for (const role of ASSIGNMENT_ROLE_PRIORITY) {
    const match = assignments.find((a) => a.role === role);
    if (match)
      return {
        role: match.role,
        staffUserId: match.staffUserId,
        staffUserName: match.staffUser.name,
      };
  }
  const first = assignments[0];
  if (!first) return null;
  return { role: first.role, staffUserId: first.staffUserId, staffUserName: first.staffUser.name };
}

function summarizeCardProofGroups(
  groups: BoardOrderRow["proofGroups"],
  blockedProofGroupIds: Set<string>,
  staffNames: Map<string, string>,
): BoardCardProofSummary {
  const counts = summarizeProofGroupsForBoard(
    groups.map((g) => ({
      status: g.status,
      hasOpenIntegrationFailure: blockedProofGroupIds.has(g.id),
    })),
  );

  let latestThumbnail: { assetId: string; mimeType: string | null } | null = null;
  for (const group of groups) {
    if (group.status === "CANCELLED") continue;
    const asset = group.versions[0]?.assets[0];
    if (asset) {
      latestThumbnail = { assetId: asset.id, mimeType: asset.mimeType };
      break;
    }
  }

  const assignedStaffNames = [
    ...new Set(
      groups
        .filter(
          (g): g is typeof g & { assignedStaffId: string } =>
            g.status !== "CANCELLED" && !!g.assignedStaffId,
        )
        .map((g) => staffNames.get(g.assignedStaffId) ?? "Unknown staff member"),
    ),
  ];

  return { ...counts, latestThumbnail, assignedStaffNames };
}

function toBoardCard(
  row: BoardOrderRow,
  now: Date,
  blockedProofGroupIds: Set<string>,
  staffNames: Map<string, string>,
  failedDeliveryOrderIds: Set<string>,
  missingProductionArtworkOrderIds: Set<string>,
  reexportRequiredOrderIds: Set<string>,
  openProductionIssueOrderIds: Set<string>,
  freightShipmentByOrderId: Map<string, BoardCardFreightShipment>,
  warehousePickIndicators: { openIssueOrderIds: Set<string>; shortItemOrderIds: Set<string> },
  openExceptionCaseOrderIds: Set<string>,
): BoardCard {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    shopifyCreatedAt: row.shopifyCreatedAt.toISOString(),
    workflowStatus: row.workflowStatus,
    workflowStatusChangedAt: row.workflowStatusChangedAt.toISOString(),
    daysInState: daysSince(row.workflowStatusChangedAt, now),
    proofSummary: row.proofSummary,
    priority: row.priority,
    tags: row.tags,
    isPreorder: row.isPreorder,
    isWaitingOnCustomer:
      row.workflowStatus === OrderStatus.WAITING_CUSTOMER ||
      row.proofSummary === OrderProofSummary.WAITING_ON_CUSTOMER,
    hasCustomerResponseAlert: row.proofSummary === OrderProofSummary.CHANGES_REQUESTED,
    isApprovedNotExported:
      row.workflowStatus === OrderStatus.PARTIALLY_APPROVED ||
      row.workflowStatus === OrderStatus.READY_FOR_EXPORT,
    hasFailedProofDelivery: failedDeliveryOrderIds.has(row.id),
    hasMissingProductionArtwork: missingProductionArtworkOrderIds.has(row.id),
    hasReexportRequired: reexportRequiredOrderIds.has(row.id),
    productionSummary: row.productionSummary,
    hasOpenProductionIssue: openProductionIssueOrderIds.has(row.id),
    productionAssignedStaffName:
      row.assignments.find((a) => a.role === "PRODUCTION")?.staffUser.name ?? null,
    hasActiveFreightShipment: freightShipmentByOrderId.has(row.id),
    freightTrackingNumber: freightShipmentByOrderId.get(row.id)?.trackingNumber ?? null,
    freightShipment: freightShipmentByOrderId.get(row.id) ?? null,
    isCancelled: row.cancelledAt !== null,
    warehousePickSummary: row.warehousePickSummary,
    hasOpenWarehouseIssue: warehousePickIndicators.openIssueOrderIds.has(row.id),
    hasShortPickItems: warehousePickIndicators.shortItemOrderIds.has(row.id),
    hasOpenExceptionCase: openExceptionCaseOrderIds.has(row.id),
    columnKey: getBoardColumnKey(row),
    lines: row.lines.map((line) => ({
      id: line.id,
      productTitle: line.productTitle,
      variantTitle: line.variantTitle,
      quantity: line.quantity,
      imageUrl: line.imageUrl,
      sku: line.sku,
    })),
    lineCount: row._count.lines,
    proofGroupCount: row._count.proofGroups,
    proofGroupSummary: summarizeCardProofGroups(row.proofGroups, blockedProofGroupIds, staffNames),
    assignment: pickPrimaryAssignment(row.assignments),
    nearestDueDate: pickNearestDueDate(row.dueDates, now),
    integrationIssues: row.integrationFailures.map((failure) => ({
      id: failure.id,
      severity: failure.severity,
      summary: failure.summary,
    })),
    hasIntegrationIssue: row.integrationFailures.length > 0,
  };
}

// IntegrationFailure.relatedProofGroupId has no Prisma relation defined (a
// plain string reference, matching OrderNote.authorStaffId's pattern), so
// it can't be `include`d — one batched query per board load instead of
// per-card, avoiding N+1.
async function loadBlockedProofGroupIds(proofGroupIds: string[]): Promise<Set<string>> {
  if (proofGroupIds.length === 0) return new Set();
  const failures = await db.integrationFailure.findMany({
    where: { relatedProofGroupId: { in: proofGroupIds }, status: { in: OPEN_STATUSES } },
    select: { relatedProofGroupId: true },
  });
  return new Set(
    failures.map((f) => f.relatedProofGroupId).filter((id): id is string => id !== null),
  );
}

// Same batched, no-Prisma-relation pattern as loadBlockedProofGroupIds —
// KlaviyoDispatch failures are recorded as IntegrationFailure rows scoped
// by relatedOrderId (not relatedProofGroupId), so a delivery-failed
// indicator costs one more batched query, not per-card N+1, and never
// requires loading the full proof-request/response history onto the board.
async function loadFailedDeliveryOrderIds(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const failures = await db.integrationFailure.findMany({
    where: {
      relatedOrderId: { in: orderIds },
      integration: "EMAIL",
      status: { in: OPEN_STATUSES },
    },
    select: { relatedOrderId: true },
  });
  return new Set(failures.map((f) => f.relatedOrderId).filter((id): id is string => id !== null));
}

// Same batched, no-N+1 pattern as loadBlockedProofGroupIds/loadFailedDeliveryOrderIds
// — one query for the whole board load, never per-card. An order "has
// missing production artwork" when at least one of its export-eligible
// groups (APPROVED/NO_PROOF_REQUIRED) has no non-cancelled ProductionArtwork
// row at all yet.
async function loadMissingProductionArtworkOrderIds(rows: BoardOrderRow[]): Promise<Set<string>> {
  const eligibleGroupIds = rows.flatMap((r) =>
    r.proofGroups
      .filter((g) => g.status === "APPROVED" || g.status === "NO_PROOF_REQUIRED")
      .map((g) => g.id),
  );
  if (eligibleGroupIds.length === 0) return new Set();

  const groupsWithArtwork = await db.productionArtwork.findMany({
    where: { proofGroupId: { in: eligibleGroupIds }, status: { not: "CANCELLED" } },
    select: { proofGroupId: true },
    distinct: ["proofGroupId"],
  });
  const groupIdsWithArtwork = new Set(groupsWithArtwork.map((a) => a.proofGroupId));
  const missingGroupIds = new Set(eligibleGroupIds.filter((id) => !groupIdsWithArtwork.has(id)));

  return new Set(
    rows.filter((r) => r.proofGroups.some((g) => missingGroupIds.has(g.id))).map((r) => r.id),
  );
}

// A group "needs re-export" when it's currently READY_FOR_EXPORT but also
// already has a prior EXPORTED revision — i.e. a correction was prepared
// and marked ready after the group's original export, so the existing
// export package on file no longer reflects what's actually approved.
async function loadReexportRequiredOrderIds(rows: BoardOrderRow[]): Promise<Set<string>> {
  const readyGroupIds = rows.flatMap((r) =>
    r.proofGroups.filter((g) => g.status === "READY_FOR_EXPORT").map((g) => g.id),
  );
  if (readyGroupIds.length === 0) return new Set();

  const priorExports = await db.productionArtwork.findMany({
    where: { proofGroupId: { in: readyGroupIds }, status: "EXPORTED" },
    select: { proofGroupId: true },
    distinct: ["proofGroupId"],
  });
  const reexportGroupIds = new Set(priorExports.map((a) => a.proofGroupId));

  return new Set(
    rows.filter((r) => r.proofGroups.some((g) => reexportGroupIds.has(g.id))).map((r) => r.id),
  );
}

const OPEN_PRODUCTION_ISSUE_STATUSES: ProductionIssueStatus[] = [
  "OPEN",
  "INVESTIGATING",
  "WAITING",
];

// Same batched, no-N+1 pattern as the other loadX helpers above —
// ProductionIssue.orderId is a real FK (unlike the loose proofGroupId/
// artworkId snapshot fields on that model), so one indexed query for the
// whole board load covers every card (Milestone 11).
async function loadOpenProductionIssueOrderIds(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const issues = await db.productionIssue.findMany({
    where: { orderId: { in: orderIds }, status: { in: OPEN_PRODUCTION_ISSUE_STATUSES } },
    select: { orderId: true },
    distinct: ["orderId"],
  });
  return new Set(issues.map((i) => i.orderId));
}

// Card-level freight shipment shape for the inline Pack-column controls
// (weight/dims/carrier so the card can distinguish "no shipment yet, show
// the create-new form" from "already has one, show its status") — kept
// alongside, not replacing, the lighter hasActiveFreightShipment/
// freightTrackingNumber fields the existing indicator chip already uses.
export interface BoardCardFreightShipment {
  id: string;
  status: "PREPARING" | "CREATED";
  trackingNumber: string | null;
  weightKg: number | null;
  heightM: number | null;
  widthM: number | null;
  lengthM: number | null;
  carrierCode: string;
  carrierServiceCode: string;
}

// Same batched, no-N+1 pattern as loadOpenProductionIssueOrderIds —
// FreightShipment.orderId is a real FK, so one indexed query per board load
// covers every card (Milestone 12). Prefers a CREATED shipment over a still-
// PREPARING one when an order somehow has more than one non-terminal row
// (shouldn't normally happen — creation rejects a second active shipment —
// but this stays defensive rather than assuming).
async function loadFreightShipmentsByOrderId(
  orderIds: string[],
): Promise<Map<string, BoardCardFreightShipment>> {
  if (orderIds.length === 0) return new Map();
  const shipments = await db.freightShipment.findMany({
    where: { orderId: { in: orderIds }, status: { in: ["PREPARING", "CREATED"] } },
    select: {
      orderId: true,
      id: true,
      status: true,
      trackingNumber: true,
      weightKg: true,
      heightM: true,
      widthM: true,
      lengthM: true,
      carrierCode: true,
      carrierServiceCode: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const result = new Map<string, BoardCardFreightShipment>();
  for (const shipment of shipments) {
    const existing = result.get(shipment.orderId);
    if (!existing || (shipment.status === "CREATED" && existing.status !== "CREATED")) {
      result.set(shipment.orderId, {
        id: shipment.id,
        // The where clause above guarantees only PREPARING/CREATED rows are
        // ever fetched — Prisma's generated type doesn't narrow on that,
        // hence the assertion.
        status: shipment.status as "PREPARING" | "CREATED",
        trackingNumber: shipment.trackingNumber,
        weightKg: shipment.weightKg,
        heightM: shipment.heightM,
        widthM: shipment.widthM,
        lengthM: shipment.lengthM,
        carrierCode: shipment.carrierCode,
        carrierServiceCode: shipment.carrierServiceCode,
      });
    }
  }
  return result;
}

// Same batched, no-N+1 pattern as loadOpenProductionIssueOrderIds — two
// small indexed queries (WarehouseIssue.orderId and
// WarehousePickItem.status via its job's orderId) cover every card in one
// pass each per board load (Milestone 13).
async function loadWarehousePickIndicatorsByOrderId(orderIds: string[]): Promise<{
  openIssueOrderIds: Set<string>;
  shortItemOrderIds: Set<string>;
}> {
  if (orderIds.length === 0) return { openIssueOrderIds: new Set(), shortItemOrderIds: new Set() };
  const [issues, shortItems] = await Promise.all([
    db.warehouseIssue.findMany({
      where: { orderId: { in: orderIds }, status: { in: ["OPEN", "INVESTIGATING", "WAITING"] } },
      select: { orderId: true },
      distinct: ["orderId"],
    }),
    db.warehousePickItem.findMany({
      where: { status: "SHORT", warehousePickJob: { orderId: { in: orderIds } } },
      select: { warehousePickJob: { select: { orderId: true } } },
      distinct: ["warehousePickJobId"],
    }),
  ]);
  return {
    openIssueOrderIds: new Set(issues.map((i) => i.orderId)),
    shortItemOrderIds: new Set(shortItems.map((i) => i.warehousePickJob.orderId)),
  };
}

// Same batched, no-N+1 pattern as loadOpenProductionIssueOrderIds —
// ExceptionCase.orderId is a real FK, so one indexed query per board load
// covers every card (Milestone 14).
async function loadOpenExceptionCaseOrderIds(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const cases = await db.exceptionCase.findMany({
    where: { orderId: { in: orderIds }, status: { notIn: ["RESOLVED", "CANCELLED"] } },
    select: { orderId: true },
    distinct: ["orderId"],
  });
  return new Set(cases.map((c) => c.orderId));
}

async function loadProofGroupBoardContext(rows: BoardOrderRow[]): Promise<{
  blockedProofGroupIds: Set<string>;
  staffNames: Map<string, string>;
  failedDeliveryOrderIds: Set<string>;
  missingProductionArtworkOrderIds: Set<string>;
  reexportRequiredOrderIds: Set<string>;
  openProductionIssueOrderIds: Set<string>;
  freightShipmentByOrderId: Map<string, BoardCardFreightShipment>;
  warehousePickIndicators: { openIssueOrderIds: Set<string>; shortItemOrderIds: Set<string> };
  openExceptionCaseOrderIds: Set<string>;
}> {
  const proofGroupIds = rows.flatMap((r) => r.proofGroups.map((g) => g.id));
  const staffIds = rows.flatMap((r) => r.proofGroups.map((g) => g.assignedStaffId));
  const orderIds = rows.map((r) => r.id);
  const [
    blockedProofGroupIds,
    staffNames,
    failedDeliveryOrderIds,
    missingProductionArtworkOrderIds,
    reexportRequiredOrderIds,
    openProductionIssueOrderIds,
    freightShipmentByOrderId,
    warehousePickIndicators,
    openExceptionCaseOrderIds,
  ] = await Promise.all([
    loadBlockedProofGroupIds(proofGroupIds),
    resolveStaffNames(staffIds),
    loadFailedDeliveryOrderIds(orderIds),
    loadMissingProductionArtworkOrderIds(rows),
    loadReexportRequiredOrderIds(rows),
    loadOpenProductionIssueOrderIds(orderIds),
    loadFreightShipmentsByOrderId(orderIds),
    loadWarehousePickIndicatorsByOrderId(orderIds),
    loadOpenExceptionCaseOrderIds(orderIds),
  ]);
  return {
    blockedProofGroupIds,
    staffNames,
    failedDeliveryOrderIds,
    missingProductionArtworkOrderIds,
    reexportRequiredOrderIds,
    openProductionIssueOrderIds,
    freightShipmentByOrderId,
    warehousePickIndicators,
    openExceptionCaseOrderIds,
  };
}

function buildSearchWhere(term: string): Prisma.ShopifyOrderWhereInput {
  const trimmed = term.trim();
  if (!trimmed) return {};
  return {
    OR: [
      { orderNumber: { contains: trimmed, mode: "insensitive" } },
      { customerName: { contains: trimmed, mode: "insensitive" } },
      { customerEmail: { contains: trimmed, mode: "insensitive" } },
      // Tag matching here is exact (case-sensitive), not substring — Postgres
      // array columns don't support ILIKE-across-elements without raw SQL.
      // Use the dedicated tag filter for partial/case-insensitive tag search.
      { tags: { has: trimmed } },
      {
        lines: {
          some: {
            OR: [
              { productTitle: { contains: trimmed, mode: "insensitive" } },
              { sku: { contains: trimmed, mode: "insensitive" } },
            ],
          },
        },
      },
    ],
  };
}

const ORDER_AGE_DAYS: Record<string, number> = {
  over_7_days: 7,
  over_14_days: 14,
  over_30_days: 30,
};

export function buildBoardWhere(
  shopId: string,
  filters: BoardFilters,
  currentStaffUserId: string,
  now: Date,
): Prisma.ShopifyOrderWhereInput {
  const and: Prisma.ShopifyOrderWhereInput[] = [{ shopId }];

  if (filters.priority.length > 0) and.push({ priority: { in: filters.priority } });
  if (filters.tags.length > 0) and.push({ tags: { hasSome: filters.tags } });
  if (filters.preorder !== undefined) and.push({ isPreorder: filters.preorder });
  if (filters.noProofRequired) and.push({ proofSummary: OrderProofSummary.NO_PROOFS_REQUIRED });
  if (filters.customerResponse) and.push({ proofSummary: OrderProofSummary.CHANGES_REQUESTED });
  if (filters.waitingOnCustomer) {
    and.push({
      OR: [
        { workflowStatus: OrderStatus.WAITING_CUSTOMER },
        { proofSummary: OrderProofSummary.WAITING_ON_CUSTOMER },
      ],
    });
  }
  if (filters.integrationIssue) {
    and.push({ integrationFailures: { some: { status: { in: OPEN_STATUSES } } } });
  }
  if (filters.assignment === "unassigned") {
    and.push({ assignments: { none: { unassignedAt: null } } });
  } else if (filters.assignment === "me") {
    and.push({ assignments: { some: { unassignedAt: null, staffUserId: currentStaffUserId } } });
  } else if (filters.assignment === "staff" && filters.assignedStaffId) {
    and.push({
      assignments: { some: { unassignedAt: null, staffUserId: filters.assignedStaffId } },
    });
  }
  if (filters.orderAge !== "any") {
    const days = ORDER_AGE_DAYS[filters.orderAge];
    if (days) and.push({ shopifyCreatedAt: { lte: new Date(now.getTime() - days * 86_400_000) } });
  }
  if (filters.search) and.push(buildSearchWhere(filters.search));

  return { AND: and };
}

function applyDueDateStateFilter(cards: BoardCard[], states: DueDateState[]): BoardCard[] {
  if (states.length === 0) return cards;
  return cards.filter((card) => states.includes(card.nearestDueDate?.state ?? "none"));
}

function buildSqlOrderBy(sortField: SortField): Prisma.ShopifyOrderOrderByWithRelationInput[] {
  switch (sortField) {
    case "priority":
      return [{ priority: "desc" }, { id: "asc" }];
    case "oldest_order":
      return [{ shopifyCreatedAt: "asc" }, { id: "asc" }];
    case "newest_order":
      return [{ shopifyCreatedAt: "desc" }, { id: "asc" }];
    case "longest_in_state":
      return [{ workflowStatusChangedAt: "asc" }, { id: "asc" }];
    case "order_number":
      return [{ orderNumber: "asc" }, { id: "asc" }];
    case "due_date":
    case "urgency_default":
    default:
      // Approximate ordering only — the exact due_date/urgency_default
      // comparator (compareCards below) is applied in JS afterward since it
      // needs the computed nearest-due-date, which isn't a plain column.
      return [{ priority: "desc" }, { workflowStatusChangedAt: "asc" }, { id: "asc" }];
  }
}

function dueDateSortValue(card: BoardCard): number {
  return card.nearestDueDate
    ? new Date(card.nearestDueDate.dueDate).getTime()
    : Number.POSITIVE_INFINITY;
}

function tiebreak(a: BoardCard, b: BoardCard): number {
  return a.id.localeCompare(b.id);
}

// The documented default: urgent, then high, then overdue, then earliest
// due date, then oldest in its current state — never buries older active
// work behind an arbitrary secondary key.
function urgencyDefaultCompare(a: BoardCard, b: BoardCard): number {
  const tierDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  if (tierDiff !== 0) return tierDiff;

  const aOverdue = a.nearestDueDate?.state === "overdue" ? 0 : 1;
  const bOverdue = b.nearestDueDate?.state === "overdue" ? 0 : 1;
  if (aOverdue !== bOverdue) return aOverdue - bOverdue;

  const dueDiff = dueDateSortValue(a) - dueDateSortValue(b);
  if (dueDiff !== 0) return dueDiff;

  return a.workflowStatusChangedAt.localeCompare(b.workflowStatusChangedAt) || tiebreak(a, b);
}

export function compareCards(a: BoardCard, b: BoardCard, sortField: SortField): number {
  switch (sortField) {
    case "priority":
      return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || tiebreak(a, b);
    case "due_date":
      return dueDateSortValue(a) - dueDateSortValue(b) || tiebreak(a, b);
    case "oldest_order":
      return a.shopifyCreatedAt.localeCompare(b.shopifyCreatedAt) || tiebreak(a, b);
    case "newest_order":
      return b.shopifyCreatedAt.localeCompare(a.shopifyCreatedAt) || tiebreak(a, b);
    case "longest_in_state":
      return a.workflowStatusChangedAt.localeCompare(b.workflowStatusChangedAt) || tiebreak(a, b);
    case "order_number":
      return (
        a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true }) || tiebreak(a, b)
      );
    case "urgency_default":
    default:
      return urgencyDefaultCompare(a, b);
  }
}

export interface LoadBoardResult {
  columns: BoardColumnResult[];
  fetchedAt: string;
}

// Fetches a bounded total (PER_COLUMN_LIMIT * column count) of active
// orders, buckets them into columns in JS using the exact same
// getBoardColumnKey function the rest of the app uses (zero drift risk),
// then slices each bucket to its own display limit. A column with more
// matches than fit in the shared cap is topped up via loadMoreForColumn,
// which queries that one column directly and indexedly.
export async function loadBoardColumns(params: {
  shopId: string;
  filters: BoardFilters;
  sort: BoardSort;
  currentStaffUserId: string;
  now?: Date;
}): Promise<LoadBoardResult> {
  const now = params.now ?? new Date();
  const baseWhere = buildBoardWhere(params.shopId, params.filters, params.currentStaffUserId, now);
  const where: Prisma.ShopifyOrderWhereInput = {
    AND: [baseWhere, { workflowStatus: { notIn: SPECIAL_STATUS_VALUES } }],
  };

  const fetchCap = PER_COLUMN_LIMIT * BOARD_COLUMNS.length;
  const rows = await db.shopifyOrder.findMany({
    where,
    select: BOARD_CARD_SELECT,
    orderBy: buildSqlOrderBy(params.sort.field),
    take: fetchCap,
  });

  const {
    blockedProofGroupIds,
    staffNames,
    failedDeliveryOrderIds,
    missingProductionArtworkOrderIds,
    reexportRequiredOrderIds,
    openProductionIssueOrderIds,
    freightShipmentByOrderId,
    warehousePickIndicators,
    openExceptionCaseOrderIds,
  } = await loadProofGroupBoardContext(rows);
  let cards = rows.map((row) =>
    toBoardCard(
      row,
      now,
      blockedProofGroupIds,
      staffNames,
      failedDeliveryOrderIds,
      missingProductionArtworkOrderIds,
      reexportRequiredOrderIds,
      openProductionIssueOrderIds,
      freightShipmentByOrderId,
      warehousePickIndicators,
      openExceptionCaseOrderIds,
    ),
  );
  cards = applyDueDateStateFilter(cards, params.filters.dueDateStates);
  cards.sort((a, b) => compareCards(a, b, params.sort.field));

  const columns: BoardColumnResult[] = BOARD_COLUMNS.map((column) => {
    const columnCards = cards.filter((card) => card.columnKey === column.key);
    return {
      key: column.key,
      label: column.label,
      purpose: column.purpose,
      interactive: column.interactive,
      readOnlyReason: column.readOnlyReason,
      cards: columnCards.slice(0, PER_COLUMN_LIMIT),
      hasMore: columnCards.length > PER_COLUMN_LIMIT,
    };
  });

  return { columns, fetchedAt: now.toISOString() };
}

export async function loadMoreForColumn(params: {
  shopId: string;
  columnKey: BoardColumnKey;
  filters: BoardFilters;
  sort: BoardSort;
  currentStaffUserId: string;
  cursorId?: string;
  offset?: number;
  now?: Date;
}): Promise<{ cards: BoardCard[]; nextCursorId: string | null; nextOffset: number | null }> {
  const now = params.now ?? new Date();
  const column = getBoardColumn(params.columnKey);
  const baseWhere = buildBoardWhere(params.shopId, params.filters, params.currentStaffUserId, now);
  const where: Prisma.ShopifyOrderWhereInput = {
    AND: [baseWhere, column.where, { workflowStatus: { notIn: SPECIAL_STATUS_VALUES } }],
  };

  if (usesCursorPagination(params.sort.field)) {
    const rows = await db.shopifyOrder.findMany({
      where,
      select: BOARD_CARD_SELECT,
      orderBy: buildSqlOrderBy(params.sort.field),
      take: LOAD_MORE_PAGE_SIZE,
      ...(params.cursorId ? { cursor: { id: params.cursorId }, skip: 1 } : {}),
    });
    const {
      blockedProofGroupIds,
      staffNames,
      failedDeliveryOrderIds,
      missingProductionArtworkOrderIds,
      reexportRequiredOrderIds,
      openProductionIssueOrderIds,
      freightShipmentByOrderId,
      warehousePickIndicators,
      openExceptionCaseOrderIds,
    } = await loadProofGroupBoardContext(rows);
    let cards = rows.map((row) =>
      toBoardCard(
        row,
        now,
        blockedProofGroupIds,
        staffNames,
        failedDeliveryOrderIds,
        missingProductionArtworkOrderIds,
        reexportRequiredOrderIds,
        openProductionIssueOrderIds,
        freightShipmentByOrderId,
        warehousePickIndicators,
        openExceptionCaseOrderIds,
      ),
    );
    cards = applyDueDateStateFilter(cards, params.filters.dueDateStates);
    const last = rows.at(-1);
    return {
      cards,
      nextCursorId: rows.length === LOAD_MORE_PAGE_SIZE && last ? last.id : null,
      nextOffset: null,
    };
  }

  const offset = params.offset ?? 0;
  const rows = await db.shopifyOrder.findMany({
    where,
    select: BOARD_CARD_SELECT,
    orderBy: buildSqlOrderBy(params.sort.field),
    take: MAX_OFFSET_PAGINATION_ROWS,
  });
  const {
    blockedProofGroupIds,
    staffNames,
    failedDeliveryOrderIds,
    missingProductionArtworkOrderIds,
    reexportRequiredOrderIds,
    openProductionIssueOrderIds,
    freightShipmentByOrderId,
    warehousePickIndicators,
    openExceptionCaseOrderIds,
  } = await loadProofGroupBoardContext(rows);
  let cards = rows.map((row) =>
    toBoardCard(
      row,
      now,
      blockedProofGroupIds,
      staffNames,
      failedDeliveryOrderIds,
      missingProductionArtworkOrderIds,
      reexportRequiredOrderIds,
      openProductionIssueOrderIds,
      freightShipmentByOrderId,
      warehousePickIndicators,
      openExceptionCaseOrderIds,
    ),
  );
  cards = applyDueDateStateFilter(cards, params.filters.dueDateStates);
  cards.sort((a, b) => compareCards(a, b, params.sort.field));
  const page = cards.slice(offset, offset + LOAD_MORE_PAGE_SIZE);
  const nextOffset =
    offset + LOAD_MORE_PAGE_SIZE < cards.length ? offset + LOAD_MORE_PAGE_SIZE : null;
  return { cards: page, nextCursorId: null, nextOffset };
}

export async function loadSpecialView(params: {
  shopId: string;
  view: SpecialViewKey;
  filters: BoardFilters;
  currentStaffUserId: string;
  cursorId?: string;
  now?: Date;
}): Promise<{ cards: BoardCard[]; nextCursorId: string | null }> {
  const now = params.now ?? new Date();
  const status = SPECIAL_STATUSES[params.view];
  const baseWhere = buildBoardWhere(params.shopId, params.filters, params.currentStaffUserId, now);
  const where: Prisma.ShopifyOrderWhereInput = { AND: [baseWhere, { workflowStatus: status }] };

  const rows = await db.shopifyOrder.findMany({
    where,
    select: BOARD_CARD_SELECT,
    orderBy: [{ workflowStatusChangedAt: "desc" }, { id: "asc" }],
    take: LOAD_MORE_PAGE_SIZE,
    ...(params.cursorId ? { cursor: { id: params.cursorId }, skip: 1 } : {}),
  });
  const {
    blockedProofGroupIds,
    staffNames,
    failedDeliveryOrderIds,
    missingProductionArtworkOrderIds,
    reexportRequiredOrderIds,
    openProductionIssueOrderIds,
    freightShipmentByOrderId,
    warehousePickIndicators,
    openExceptionCaseOrderIds,
  } = await loadProofGroupBoardContext(rows);
  const cards = rows.map((row) =>
    toBoardCard(
      row,
      now,
      blockedProofGroupIds,
      staffNames,
      failedDeliveryOrderIds,
      missingProductionArtworkOrderIds,
      reexportRequiredOrderIds,
      openProductionIssueOrderIds,
      freightShipmentByOrderId,
      warehousePickIndicators,
      openExceptionCaseOrderIds,
    ),
  );
  const last = rows.at(-1);
  return { cards, nextCursorId: rows.length === LOAD_MORE_PAGE_SIZE && last ? last.id : null };
}

export interface BoardFilterOptions {
  staff: { id: string; name: string }[];
  tags: string[];
}

// Distinct tags via a raw query (Postgres array columns have no
// Prisma-native "distinct element" aggregate) — capped and read-only, no
// user input is interpolated so this carries no injection risk.
export async function getBoardFilterOptions(shopId: string): Promise<BoardFilterOptions> {
  const [staff, tagRows] = await Promise.all([
    db.staffUser.findMany({
      where: { shopId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.$queryRaw<{ tag: string }[]>`
      SELECT DISTINCT unnest(tags) AS tag FROM "ShopifyOrder" WHERE "shopId" = ${shopId} ORDER BY tag ASC LIMIT 200
    `,
  ]);
  return { staff, tags: tagRows.map((row) => row.tag) };
}
