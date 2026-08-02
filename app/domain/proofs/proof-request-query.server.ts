import type {
  ChangeRequestCategory,
  EmailStatus,
  ProofRequestStatus,
  ResponseType,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

export interface OrderDetailProofResponseAsset {
  id: string;
  storageKey: string;
  originalFilename: string | null;
  mimeType: string | null;
}

export interface OrderDetailProofRequestGroup {
  proofGroupId: string;
  proofGroupName: string;
  proofVersionId: string;
  versionNumber: number;
  /** The live status of the sent version — may have moved on (e.g. SUPERSEDED) since this request was sent. */
  currentVersionStatus: string;
  response: {
    id: string;
    responseType: ResponseType;
    customerNote: string | null;
    changeCategories: ChangeRequestCategory[];
    respondedAt: string;
    assets: OrderDetailProofResponseAsset[];
  } | null;
}

export interface OrderDetailProofDelivery {
  id: string;
  eventType: string;
  status: EmailStatus;
  queuedAt: string;
  sentAt: string | null;
  failedAt: string | null;
  retryCount: number;
}

export interface OrderDetailProofReminder {
  scheduledFor: string;
  sentAt: string | null;
  suppressed: boolean;
  suppressedReason: string | null;
}

export interface OrderDetailProofRequest {
  id: string;
  customerEmail: string;
  customerName: string | null;
  status: ProofRequestStatus;
  staffMessage: string | null;
  createdByStaffId: string;
  createdByStaffName: string;
  createdAt: string;
  sentAt: string | null;
  tokenExpiresAt: string;
  /** Derived, not stored — see ADR-0005. */
  isExpired: boolean;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  revokedAt: string | null;
  revokedReason: string | null;
  completedAt: string | null;
  groups: OrderDetailProofRequestGroup[];
  deliveries: OrderDetailProofDelivery[];
  reminder: OrderDetailProofReminder | null;
  /**
   * The exact customer-facing review URL (embeds the raw token) — read back
   * from the same KlaviyoDispatch.eventProperties.review_proof_button field
   * that resend/reminders already reuse (see ADR-0005 and technical-debt
   * item 16), surfaced here so staff can open "what the customer sees"
   * directly from the drawer. Null only if no dispatch was ever queued
   * (shouldn't normally happen — sendProofRequest always queues one).
   */
  reviewUrl: string | null;
}

function extractReviewUrl(eventProperties: unknown): string | null {
  if (!eventProperties || typeof eventProperties !== "object") return null;
  const value = (eventProperties as Record<string, unknown>).review_proof_button;
  return typeof value === "string" ? value : null;
}

export async function loadProofRequestsForOrder(params: {
  shopId: string;
  orderId: string;
}): Promise<OrderDetailProofRequest[]> {
  const requests = await db.proofRequest.findMany({
    where: { orderId: params.orderId, shopId: params.shopId },
    orderBy: { createdAt: "desc" },
    include: {
      groups: {
        include: {
          proofGroup: { select: { name: true } },
          proofVersion: {
            select: {
              versionNumber: true,
              status: true,
              responses: {
                include: { assets: true },
                orderBy: { respondedAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
      klaviyoDispatches: { orderBy: { queuedAt: "desc" } },
      reminders: true,
    },
  });

  if (requests.length === 0) return [];

  const staffNames = await resolveStaffNames(requests.map((r) => r.createdByStaffId));
  const now = Date.now();

  return requests.map((request): OrderDetailProofRequest => {
    const reminder = request.reminders[0] ?? null;
    const reviewUrl = extractReviewUrl(request.klaviyoDispatches[0]?.eventProperties);
    return {
      id: request.id,
      reviewUrl,
      customerEmail: request.customerEmail,
      customerName: request.customerName,
      status: request.status,
      staffMessage: request.staffMessage,
      createdByStaffId: request.createdByStaffId,
      createdByStaffName: staffNames.get(request.createdByStaffId) ?? "Unknown staff member",
      createdAt: request.createdAt.toISOString(),
      sentAt: request.sentAt?.toISOString() ?? null,
      tokenExpiresAt: request.tokenExpiresAt.toISOString(),
      isExpired: request.tokenExpiresAt.getTime() < now,
      firstViewedAt: request.firstViewedAt?.toISOString() ?? null,
      lastViewedAt: request.lastViewedAt?.toISOString() ?? null,
      viewCount: request.viewCount,
      revokedAt: request.revokedAt?.toISOString() ?? null,
      revokedReason: request.revokedReason,
      completedAt: request.completedAt?.toISOString() ?? null,
      groups: request.groups.map((link) => {
        const response = link.proofVersion.responses[0] ?? null;
        return {
          proofGroupId: link.proofGroupId,
          proofGroupName: link.proofGroup.name,
          proofVersionId: link.proofVersionId,
          versionNumber: link.proofVersion.versionNumber,
          currentVersionStatus: link.proofVersion.status,
          response: response
            ? {
                id: response.id,
                responseType: response.responseType,
                customerNote: response.customerNote,
                changeCategories: response.changeCategories,
                respondedAt: response.respondedAt.toISOString(),
                assets: response.assets.map((asset) => ({
                  id: asset.id,
                  storageKey: asset.storageKey,
                  originalFilename: asset.originalFilename,
                  mimeType: asset.mimeType,
                })),
              }
            : null,
        };
      }),
      deliveries: request.klaviyoDispatches.map((d) => ({
        id: d.id,
        eventType: d.eventType,
        status: d.status,
        queuedAt: d.queuedAt.toISOString(),
        sentAt: d.sentAt?.toISOString() ?? null,
        failedAt: d.failedAt?.toISOString() ?? null,
        retryCount: d.retryCount,
      })),
      reminder: reminder
        ? {
            scheduledFor: reminder.scheduledFor.toISOString(),
            sentAt: reminder.sentAt?.toISOString() ?? null,
            suppressed: reminder.suppressed,
            suppressedReason: reminder.suppressedReason,
          }
        : null,
    };
  });
}
