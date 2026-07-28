import { ActorType, type Prisma, type PrismaClient } from "@prisma/client";
import { OPEN_STATUSES } from "~/domain/integrations/record-failure.server";
import { PROOF_SUMMARY_LABELS } from "~/domain/orders/labels";
import {
  calculateOrderProofSummary,
  type ProofGroupSummaryInput,
} from "~/domain/proofs/order-proof-summary";

type TxClient = Prisma.TransactionClient | PrismaClient;

async function loadGroupsForSummary(
  tx: TxClient,
  orderId: string,
): Promise<ProofGroupSummaryInput[]> {
  const groups = await tx.proofGroup.findMany({
    where: { orderId, status: { not: "CANCELLED" } },
    select: {
      id: true,
      status: true,
      versions: { where: { status: { not: "CANCELLED" } }, select: { id: true }, take: 1 },
    },
  });
  if (groups.length === 0) return [];

  const failures = await tx.integrationFailure.findMany({
    where: { relatedProofGroupId: { in: groups.map((g) => g.id) }, status: { in: OPEN_STATUSES } },
    select: { relatedProofGroupId: true },
  });
  const blockedGroupIds = new Set(
    failures.map((f) => f.relatedProofGroupId).filter((id): id is string => id !== null),
  );

  return groups.map((g) => ({
    isReadyToSend: g.status === "READY_TO_SEND",
    hasAnyVersion: g.versions.length > 0,
    isNoProofRequired: g.status === "NO_PROOF_REQUIRED",
    hasOpenIntegrationFailure: blockedGroupIds.has(g.id),
  }));
}

/**
 * The one writer of ShopifyOrder.proofSummary. Must be called at the end of
 * every proof-domain mutation, inside the same transaction as that
 * mutation's other writes. A no-op (no ActivityEvent, no update) when the
 * recalculated value matches what's already stored — never fabricates a
 * change that didn't happen.
 */
export async function recalculateOrderProofSummary(
  tx: TxClient,
  params: { shopId: string; orderId: string; actorStaffId: string | null },
): Promise<void> {
  const order = await tx.shopifyOrder.findUniqueOrThrow({
    where: { id: params.orderId },
    select: { proofSummary: true },
  });
  const groups = await loadGroupsForSummary(tx, params.orderId);
  const newSummary = calculateOrderProofSummary(groups);

  if (newSummary === order.proofSummary) return;

  await tx.shopifyOrder.update({
    where: { id: params.orderId },
    data: { proofSummary: newSummary },
  });
  await tx.activityEvent.create({
    data: {
      shopId: params.shopId,
      orderId: params.orderId,
      entityType: "ShopifyOrder",
      entityId: params.orderId,
      eventType: "order_proof_summary_changed",
      summary: `Order proof summary changed from ${PROOF_SUMMARY_LABELS[order.proofSummary]} to ${PROOF_SUMMARY_LABELS[newSummary]}`,
      metadata: { previousSummary: order.proofSummary, newSummary, source: "proof_groups" },
      actorStaffId: params.actorStaffId,
      actorType: params.actorStaffId ? ActorType.STAFF : ActorType.SYSTEM,
    },
  });
}
