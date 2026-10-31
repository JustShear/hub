import { ActorType, type OrderProofSummary } from "@prisma/client";
import { db } from "~/lib/db.server";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";
import { syncOrderLifecycleTag } from "~/domain/orders/sync-order-lifecycle-tag.server";

// When a logged-in customer reorders and picks one of their previously
// approved proofs in the product options app, that app writes a hidden line
// property named "_previous_proof" (optionally "_previous_proof: <field>")
// whose value is the id of the approved ProofVersion they picked. This module
// turns that into a new proof group on the new order that is ALREADY approved,
// reusing the earlier artwork, flagged so staff can see - and undo - it.
//
// The property is customer-controlled data, so it is never trusted: the source
// version must be APPROVED and must belong to an order of the SAME Shopify
// customer as this order. A forged or stale id is ignored (and noted in the
// activity log), never acted on.

export const REUSED_PROOF_PROPERTY_PREFIX = "_previous_proof";

const SOURCE_GROUP_STATUSES = ["APPROVED", "READY_FOR_EXPORT", "EXPORTED_FOR_PRINT"] as const;
const SYSTEM_ACTOR_ID = "system:reorder";

const APPROVED_SUMMARIES: OrderProofSummary[] = [
  "PARTIALLY_APPROVED",
  "ALL_REQUIRED_PROOFS_APPROVED",
];

export function isReusedProofPropertyName(name: string): boolean {
  return name.trim().toLowerCase().startsWith(REUSED_PROOF_PROPERTY_PREFIX);
}

export interface ApplyReusedProofsResult {
  created: number;
  ignored: number;
}

/**
 * Idempotent: safe to call on every import of the order. A source version that
 * has already been reused on this order - even if staff later undid it - is
 * never reused again.
 */
export async function applyReusedProofsForOrder(input: {
  shopId: string;
  orderId: string;
}): Promise<ApplyReusedProofsResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: {
      id: true,
      orderNumber: true,
      customerShopifyGid: true,
      lines: {
        select: {
          id: true,
          quantity: true,
          properties: { select: { name: true, value: true } },
        },
      },
    },
  });
  if (!order) {
    return { created: 0, ignored: 0 };
  }

  const requests: { lineId: string; quantity: number; sourceVersionId: string }[] = [];
  for (const line of order.lines) {
    for (const property of line.properties) {
      const value = property.value.trim();
      if (isReusedProofPropertyName(property.name) && value) {
        requests.push({ lineId: line.id, quantity: line.quantity, sourceVersionId: value });
      }
    }
  }
  if (requests.length === 0) {
    return { created: 0, ignored: 0 };
  }

  let created = 0;
  let ignored = 0;
  let latestSummary: OrderProofSummary | null = null;

  for (const request of requests) {
    const alreadyReused = await db.proofVersion.findFirst({
      where: {
        reusedFromVersionId: request.sourceVersionId,
        proofGroup: { orderId: order.id },
      },
      select: { id: true },
    });
    if (alreadyReused) {
      continue;
    }

    const source = await db.proofVersion.findFirst({
      where: {
        id: request.sourceVersionId,
        status: "APPROVED",
        proofGroup: {
          status: { in: [...SOURCE_GROUP_STATUSES] },
          order: {
            shopId: input.shopId,
            id: { not: order.id },
            // Same customer, and never matched on a missing id.
            customerShopifyGid: order.customerShopifyGid ?? "__no_customer__",
          },
        },
      },
      select: {
        id: true,
        versionNumber: true,
        assets: true,
        proofGroup: {
          select: {
            name: true,
            decorationMethod: true,
            placement: true,
            order: { select: { orderNumber: true } },
          },
        },
      },
    });

    if (!source || !order.customerShopifyGid) {
      ignored += 1;
      await db.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: order.id,
          entityType: "ShopifyOrder",
          entityId: order.id,
          eventType: "proof_reuse_ignored",
          summary:
            "The customer picked a previous proof while ordering, but it couldn't be reused (it isn't an approved proof belonging to this customer).",
          metadata: { requestedVersionId: request.sourceVersionId },
          actorType: ActorType.SYSTEM,
        },
      });
      continue;
    }

    const sourceLabel = `${source.proofGroup.order.orderNumber} (version ${source.versionNumber})`;

    latestSummary = await db.$transaction(async (tx) => {
      const now = new Date();
      const group = await tx.proofGroup.create({
        data: {
          orderId: order.id,
          name: `Reorder: ${source.proofGroup.name}`,
          decorationMethod: source.proofGroup.decorationMethod,
          placement: source.proofGroup.placement,
          artworkContextNote: `Reused approved artwork from ${sourceLabel} - picked by the customer when ordering.`,
          status: "APPROVED",
          requiresApproval: true,
        },
      });

      await tx.proofRequirement.create({
        data: {
          orderId: order.id,
          proofGroupId: group.id,
          value: "REQUIRED",
          decidedAt: now,
        },
      });

      await tx.proofGroupOrderLine.create({
        data: {
          proofGroupId: group.id,
          orderLineId: request.lineId,
          quantity: request.quantity,
        },
      });

      const version = await tx.proofVersion.create({
        data: {
          proofGroupId: group.id,
          versionNumber: 1,
          status: "APPROVED",
          createdByStaffId: SYSTEM_ACTOR_ID,
          internalNote: `Reused from ${sourceLabel}.`,
          reusedFromVersionId: source.id,
          sentAt: null,
          respondedAt: now,
          approvedAt: now,
        },
      });

      // Same stored file, new rows: the artwork itself is shared (never
      // copied or moved), so nothing done to this order can affect the
      // original proof's files.
      if (source.assets.length > 0) {
        await tx.proofAsset.createMany({
          data: source.assets.map((asset) => ({
            proofVersionId: version.id,
            storageKey: asset.storageKey,
            isPrimary: asset.isPrimary,
            sortOrder: asset.sortOrder,
            originalFilename: asset.originalFilename,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            checksum: asset.checksum,
            width: asset.width,
            height: asset.height,
            uploadedByStaffId: null,
          })),
        });
      }

      await tx.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: order.id,
          entityType: "ProofGroup",
          entityId: group.id,
          eventType: "proof_group_reused",
          summary: `Customer reused their approved proof from ${sourceLabel} - "${group.name}" is already approved`,
          metadata: { sourceVersionId: source.id, proofVersionId: version.id },
          actorType: ActorType.SYSTEM,
        },
      });

      return recalculateOrderProofSummary(tx, {
        shopId: input.shopId,
        orderId: order.id,
        actorStaffId: null,
      });
    });
    created += 1;
  }

  // Same tag the manual/customer approval paths set, so the card moves to
  // Proof Approved. Never lets a Shopify hiccup fail the order import that
  // called this - a failure is recorded by the sync itself and can be retried.
  if (created > 0 && latestSummary !== null && APPROVED_SUMMARIES.includes(latestSummary)) {
    try {
      await syncOrderLifecycleTag({
        shopId: input.shopId,
        orderId: order.id,
        addTag: "proof_accepted",
        removeTags: ["proof_sent", "proof_rejected"],
      });
    } catch {
      // Defensive backstop only - syncOrderLifecycleTag does not throw.
    }
  }

  return { created, ignored };
}

export type UndoReusedProofResult =
  { outcome: "undone" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

/**
 * One-click "undo" for a reused proof: cancels the auto-approved copy so the
 * order goes back to needing a real proof. Only the copy is touched - the
 * customer's original approved proof is never modified. Refused once the
 * artwork has moved on to export, since by then it's real production work.
 */
export async function undoReusedProof(input: {
  shopId: string;
  proofGroupId: string;
  staffUserId: string;
}): Promise<UndoReusedProofResult> {
  const group = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
    select: {
      id: true,
      name: true,
      status: true,
      orderId: true,
      versions: {
        where: { reusedFromVersionId: { not: null } },
        select: { id: true },
      },
    },
  });
  if (!group) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }
  if (group.versions.length === 0) {
    return { outcome: "rejected", reason: "This proof group wasn't created from a reused proof." };
  }
  if (group.status === "CANCELLED") {
    return { outcome: "already_there" };
  }
  if (group.status !== "APPROVED") {
    return {
      outcome: "rejected",
      reason: "This artwork has already moved on to export, so the reuse can't be undone here.",
    };
  }

  const now = new Date();
  const outcome = await db.$transaction(async (tx) => {
    const updated = await tx.proofGroup.updateMany({
      where: { id: group.id, status: "APPROVED" },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: "Reused artwork undone by staff",
        cancelledByStaffId: input.staffUserId,
      },
    });
    if (updated.count === 0) {
      return null;
    }

    await tx.proofVersion.updateMany({
      where: { proofGroupId: group.id, status: { not: "CANCELLED" } },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: "Reused artwork undone by staff",
        cancelledByStaffId: input.staffUserId,
      },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: group.orderId,
        entityType: "ProofGroup",
        entityId: group.id,
        eventType: "proof_group_reuse_undone",
        summary: `Staff undid the reused proof "${group.name}" - this order needs a new proof`,
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    return recalculateOrderProofSummary(tx, {
      shopId: input.shopId,
      orderId: group.orderId,
      actorStaffId: input.staffUserId,
    });
  });

  if (outcome === null) {
    return { outcome: "already_there" };
  }

  // The "approved" tag only stays if some other group is still approved.
  if (!APPROVED_SUMMARIES.includes(outcome)) {
    try {
      await syncOrderLifecycleTag({
        shopId: input.shopId,
        orderId: group.orderId,
        addTag: null,
        removeTags: ["proof_accepted"],
      });
    } catch {
      // Defensive backstop only.
    }
  }

  return { outcome: "undone" };
}
