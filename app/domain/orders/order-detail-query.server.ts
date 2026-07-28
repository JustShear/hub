import type {
  ActorType,
  ArtworkAssetSourceType,
  AssignmentRole,
  DueDateSource,
  DueDateType,
  IntegrationFailureStatus,
  IntegrationType,
  NoteVisibility,
  OrderProofSummary,
  OrderStatus,
  Priority,
  PropertyDetectedType,
  Severity,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import { OPEN_STATUSES } from "~/domain/integrations/record-failure.server";
import { classifyDueDate, daysSince, type DueDateState } from "~/lib/dates";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";
import {
  loadProofGroupsForOrder,
  type OrderDetailProofGroup,
} from "~/domain/proofs/proof-group-query.server";

export const NOTES_PAGE_SIZE = 20;
export const ACTIVITY_PAGE_SIZE = 30;

// The board's own "primary assignee" pick (Milestone 06B) — the drawer edits
// exactly this one slot. The schema supports per-role assignment (OWNER,
// PACKING, PRODUCTION, GENERAL alongside ARTWORK), but building full
// multi-role assignment management is out of scope here; document this as a
// deliberate simplification, revisit once production/warehouse/packing
// screens need their own role-scoped assignee.
export const DRAWER_ASSIGNMENT_ROLE = "ARTWORK" as const;

export interface OrderDetailLineProperty {
  id: string;
  name: string;
  value: string;
  sortOrder: number | null;
  detectedType: PropertyDetectedType;
  parsedAssetId: string | null;
}

export interface OrderDetailArtworkLink {
  id: string;
  isManualReassignment: boolean;
  reassignmentReason: string | null;
  asset: {
    id: string;
    originalFilename: string | null;
    sourceType: ArtworkAssetSourceType;
    sourceUrl: string | null;
    storageKey: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    parsingUncertain: boolean;
    createdAt: string;
  };
}

export interface OrderDetailLine {
  id: string;
  shopifyLineGid: string;
  shopifyProductGid: string | null;
  shopifyVariantGid: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  fulfilledQuantity: number | null;
  imageUrl: string | null;
  discountAllocations: unknown;
  properties: OrderDetailLineProperty[];
  artworkLinks: OrderDetailArtworkLink[];
}

export interface OrderDetailDueDate {
  type: DueDateType;
  dueDate: string;
  source: DueDateSource;
  overrideReason: string | null;
  setByStaffId: string | null;
  setByStaffName: string | null;
  state: DueDateState;
}

export interface OrderDetailAssignment {
  id: string;
  role: AssignmentRole;
  staffUserId: string;
  staffUserName: string;
  assignedAt: string;
}

export interface OrderDetailNote {
  id: string;
  body: string;
  visibility: NoteVisibility;
  authorStaffId: string;
  authorStaffName: string;
  createdAt: string;
}

export interface OrderDetailActivityEvent {
  id: string;
  eventType: string;
  summary: string;
  metadata: unknown;
  actorStaffId: string | null;
  actorStaffName: string | null;
  actorType: ActorType;
  createdAt: string;
}

export interface OrderDetailIntegrationIssue {
  id: string;
  integration: IntegrationType;
  summary: string;
  severity: Severity;
  status: IntegrationFailureStatus;
  firstFailureAt: string;
  latestFailureAt: string;
  attemptCount: number;
  // Only populated when the caller passes includeTechnicalDetail — never
  // fetched at all for callers without integrations.view.
  technicalDetail?: string | null;
  attempts?: { attemptedAt: string; succeeded: boolean; errorSummary: string | null }[];
}

export interface OrderDetail {
  id: string;
  shopId: string;
  shopifyOrderGid: string;
  shopifyLegacyOrderId: string | null;
  orderNumber: string;
  shopifyCreatedAt: string;
  shopifyUpdatedAt: string | null;
  customerShopifyGid: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  noteFromCustomer: string | null;
  tags: string[];
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  shippingMethod: string | null;
  currencyCode: string | null;
  subtotalPrice: string | null;
  totalPrice: string | null;
  totalDiscounts: string | null;
  totalTax: string | null;
  discountCodes: unknown;
  shippingAddress: unknown;
  billingAddress: unknown;
  fulfillments: unknown;
  cancelledAt: string | null;
  cancelReason: string | null;
  isPreorder: boolean;
  lastSyncedAt: string | null;
  workflowStatus: OrderStatus;
  workflowStatusChangedAt: string;
  proofSummary: OrderProofSummary;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  lines: OrderDetailLine[];
  dueDates: OrderDetailDueDate[];
  assignment: OrderDetailAssignment | null;
  notes: OrderDetailNote[];
  notesTotalCount: number;
  notesHasMore: boolean;
  activity: OrderDetailActivityEvent[];
  activityHasMore: boolean;
  integrationIssues: OrderDetailIntegrationIssue[];
  proofGroups: OrderDetailProofGroup[];
  daysInState: number;
  orderAgeDays: number;
  isWaitingOnCustomer: boolean;
  hasCustomerResponseAlert: boolean;
}

function decimalToString(value: { toString: () => string } | null): string | null {
  return value === null ? null : value.toString();
}

export async function loadOrderDetail(params: {
  shopId: string;
  orderId: string;
  includeIntegrationTechnicalDetail: boolean;
}): Promise<OrderDetail | null> {
  const now = new Date();
  const order = await db.shopifyOrder.findFirst({
    where: { id: params.orderId, shopId: params.shopId },
    include: {
      lines: {
        orderBy: { createdAt: "asc" },
        include: {
          properties: { orderBy: { sortOrder: "asc" } },
          artworkLinks: { include: { asset: true } },
        },
      },
      dueDates: true,
      assignments: { where: { unassignedAt: null }, orderBy: { assignedAt: "desc" } },
      integrationFailures: {
        where: { status: { in: OPEN_STATUSES } },
        include: params.includeIntegrationTechnicalDetail
          ? { attempts: { orderBy: { attemptedAt: "desc" } } }
          : undefined,
      },
    },
  });

  if (!order) return null;

  const [notes, notesTotalCount, activity, proofGroups] = await Promise.all([
    db.orderNote.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
      take: NOTES_PAGE_SIZE,
    }),
    db.orderNote.count({ where: { orderId: order.id } }),
    db.activityEvent.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_PAGE_SIZE + 1,
    }),
    loadProofGroupsForOrder({ shopId: params.shopId, orderId: order.id }),
  ]);

  const activityHasMore = activity.length > ACTIVITY_PAGE_SIZE;
  const activityPage = activity.slice(0, ACTIVITY_PAGE_SIZE);

  const staffNames = await resolveStaffNames([
    ...order.assignments.map((a) => a.staffUserId),
    ...order.dueDates.map((d) => d.setByStaffId),
    ...notes.map((n) => n.authorStaffId),
    ...activityPage.map((e) => e.actorStaffId),
  ]);

  const primaryAssignment =
    order.assignments.find((a) => a.role === DRAWER_ASSIGNMENT_ROLE) ?? null;

  return {
    id: order.id,
    shopId: order.shopId,
    shopifyOrderGid: order.shopifyOrderGid,
    shopifyLegacyOrderId: order.shopifyLegacyOrderId,
    orderNumber: order.orderNumber,
    shopifyCreatedAt: order.shopifyCreatedAt.toISOString(),
    shopifyUpdatedAt: order.shopifyUpdatedAt?.toISOString() ?? null,
    customerShopifyGid: order.customerShopifyGid,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    noteFromCustomer: order.noteFromCustomer,
    tags: order.tags,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    shippingMethod: order.shippingMethod,
    currencyCode: order.currencyCode,
    subtotalPrice: decimalToString(order.subtotalPrice),
    totalPrice: decimalToString(order.totalPrice),
    totalDiscounts: decimalToString(order.totalDiscounts),
    totalTax: decimalToString(order.totalTax),
    discountCodes: order.discountCodes,
    shippingAddress: order.shippingAddress,
    billingAddress: order.billingAddress,
    fulfillments: order.fulfillments,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    isPreorder: order.isPreorder,
    lastSyncedAt: order.lastSyncedAt?.toISOString() ?? null,
    workflowStatus: order.workflowStatus,
    workflowStatusChangedAt: order.workflowStatusChangedAt.toISOString(),
    proofSummary: order.proofSummary,
    priority: order.priority,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    lines: order.lines.map((line) => ({
      id: line.id,
      shopifyLineGid: line.shopifyLineGid,
      shopifyProductGid: line.shopifyProductGid,
      shopifyVariantGid: line.shopifyVariantGid,
      productTitle: line.productTitle,
      variantTitle: line.variantTitle,
      sku: line.sku,
      barcode: line.barcode,
      quantity: line.quantity,
      fulfilledQuantity: line.fulfilledQuantity,
      imageUrl: line.imageUrl,
      discountAllocations: line.discountAllocations,
      properties: line.properties.map((p) => ({
        id: p.id,
        name: p.name,
        value: p.value,
        sortOrder: p.sortOrder,
        detectedType: p.detectedType,
        parsedAssetId: p.parsedAssetId,
      })),
      artworkLinks: line.artworkLinks.map((link) => ({
        id: link.id,
        isManualReassignment: link.isManualReassignment,
        reassignmentReason: link.reassignmentReason,
        asset: {
          id: link.asset.id,
          originalFilename: link.asset.originalFilename,
          sourceType: link.asset.sourceType,
          sourceUrl: link.asset.sourceUrl,
          storageKey: link.asset.storageKey,
          mimeType: link.asset.mimeType,
          sizeBytes: link.asset.sizeBytes,
          parsingUncertain: link.asset.parsingUncertain,
          createdAt: link.asset.createdAt.toISOString(),
        },
      })),
    })),
    dueDates: order.dueDates.map((d) => ({
      type: d.type,
      dueDate: d.dueDate.toISOString(),
      source: d.source,
      overrideReason: d.overrideReason,
      setByStaffId: d.setByStaffId,
      setByStaffName: d.setByStaffId ? (staffNames.get(d.setByStaffId) ?? null) : null,
      state: classifyDueDate(d.dueDate, now),
    })),
    assignment: primaryAssignment
      ? {
          id: primaryAssignment.id,
          role: primaryAssignment.role,
          staffUserId: primaryAssignment.staffUserId,
          staffUserName: staffNames.get(primaryAssignment.staffUserId) ?? "Unknown staff member",
          assignedAt: primaryAssignment.assignedAt.toISOString(),
        }
      : null,
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      visibility: n.visibility,
      authorStaffId: n.authorStaffId,
      authorStaffName: staffNames.get(n.authorStaffId) ?? "Unknown staff member",
      createdAt: n.createdAt.toISOString(),
    })),
    notesTotalCount,
    notesHasMore: notesTotalCount > notes.length,
    activity: activityPage.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      summary: e.summary,
      metadata: e.metadata,
      actorStaffId: e.actorStaffId,
      actorStaffName: e.actorStaffId
        ? (staffNames.get(e.actorStaffId) ?? "Unknown staff member")
        : null,
      actorType: e.actorType,
      createdAt: e.createdAt.toISOString(),
    })),
    activityHasMore,
    integrationIssues: order.integrationFailures.map((failure) => ({
      id: failure.id,
      integration: failure.integration,
      summary: failure.summary,
      severity: failure.severity,
      status: failure.status,
      firstFailureAt: failure.firstFailureAt.toISOString(),
      latestFailureAt: failure.latestFailureAt.toISOString(),
      attemptCount: failure.attemptCount,
      ...(params.includeIntegrationTechnicalDetail
        ? {
            technicalDetail: failure.technicalDetail,
            attempts: (
              failure as typeof failure & {
                attempts: { attemptedAt: Date; succeeded: boolean; errorSummary: string | null }[];
              }
            ).attempts.map((a) => ({
              attemptedAt: a.attemptedAt.toISOString(),
              succeeded: a.succeeded,
              errorSummary: a.errorSummary,
            })),
          }
        : {}),
    })),
    proofGroups,
    daysInState: daysSince(order.workflowStatusChangedAt, now),
    orderAgeDays: daysSince(order.shopifyCreatedAt, now),
    isWaitingOnCustomer:
      order.workflowStatus === "WAITING_CUSTOMER" || order.proofSummary === "WAITING_ON_CUSTOMER",
    hasCustomerResponseAlert: order.proofSummary === "CHANGES_REQUESTED",
  };
}

export async function loadMoreNotes(params: {
  shopId: string;
  orderId: string;
  cursorId: string;
}): Promise<{ notes: OrderDetailNote[]; hasMore: boolean }> {
  const notes = await db.orderNote.findMany({
    where: { orderId: params.orderId, order: { shopId: params.shopId } },
    orderBy: { createdAt: "desc" },
    take: NOTES_PAGE_SIZE + 1,
    cursor: { id: params.cursorId },
    skip: 1,
  });
  const hasMore = notes.length > NOTES_PAGE_SIZE;
  const page = notes.slice(0, NOTES_PAGE_SIZE);
  const staffNames = await resolveStaffNames(page.map((n) => n.authorStaffId));
  return {
    notes: page.map((n) => ({
      id: n.id,
      body: n.body,
      visibility: n.visibility,
      authorStaffId: n.authorStaffId,
      authorStaffName: staffNames.get(n.authorStaffId) ?? "Unknown staff member",
      createdAt: n.createdAt.toISOString(),
    })),
    hasMore,
  };
}

export async function loadMoreActivity(params: {
  shopId: string;
  orderId: string;
  cursorId: string;
}): Promise<{ events: OrderDetailActivityEvent[]; hasMore: boolean }> {
  const events = await db.activityEvent.findMany({
    where: { orderId: params.orderId, shopId: params.shopId },
    orderBy: { createdAt: "desc" },
    take: ACTIVITY_PAGE_SIZE + 1,
    cursor: { id: params.cursorId },
    skip: 1,
  });
  const hasMore = events.length > ACTIVITY_PAGE_SIZE;
  const page = events.slice(0, ACTIVITY_PAGE_SIZE);
  const staffNames = await resolveStaffNames(page.map((e) => e.actorStaffId));
  return {
    events: page.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      summary: e.summary,
      metadata: e.metadata,
      actorStaffId: e.actorStaffId,
      actorStaffName: e.actorStaffId
        ? (staffNames.get(e.actorStaffId) ?? "Unknown staff member")
        : null,
      actorType: e.actorType,
      createdAt: e.createdAt.toISOString(),
    })),
    hasMore,
  };
}

export async function getAssignableStaff(shopId: string): Promise<{ id: string; name: string }[]> {
  return db.staffUser.findMany({
    where: { shopId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
