import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";

export interface CancelProductionArtworkInput {
  shopId: string;
  productionArtworkId: string;
  reason: string;
  staffUserId: string;
}

export type CancelProductionArtworkResult =
  { outcome: "cancelled" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function cancelProductionArtwork(
  input: CancelProductionArtworkInput,
): Promise<CancelProductionArtworkResult> {
  const artwork = await db.productionArtwork.findFirst({
    where: { id: input.productionArtworkId, shopId: input.shopId },
    include: { proofGroup: { select: { id: true, orderId: true, status: true } } },
  });
  if (!artwork) {
    return { outcome: "rejected", reason: "Production artwork not found." };
  }
  if (artwork.status === "CANCELLED") {
    return { outcome: "already_there" };
  }
  if (artwork.status === "EXPORTED") {
    return {
      outcome: "rejected",
      reason:
        "An already-exported production artwork revision can't be cancelled — its export history is permanent.",
    };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required to cancel production artwork." };
  }

  const group = artwork.proofGroup;

  const result = await db.$transaction(async (tx) => {
    const updateResult = await tx.productionArtwork.updateMany({
      where: { id: artwork.id, status: { not: "CANCELLED" } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: trimmedReason,
        cancelledByStaffId: input.staffUserId,
      },
    });
    if (updateResult.count === 0) {
      return { alreadyCancelled: true as const };
    }

    // If this was the revision that had promoted the group to
    // READY_FOR_EXPORT, revert the group back to the underlying eligible
    // state it came from — cancelling artwork doesn't cancel the customer's
    // approval (or the no-proof-required decision) that made it eligible.
    if (group.status === "READY_FOR_EXPORT") {
      const revertedStatus = artwork.sourceProofVersionId ? "APPROVED" : "NO_PROOF_REQUIRED";
      await tx.proofGroup.update({ where: { id: group.id }, data: { status: revertedStatus } });
    }

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: group.orderId,
        entityType: "ProductionArtwork",
        entityId: artwork.id,
        eventType: "production_artwork_cancelled",
        summary: `Production artwork revision ${artwork.revisionNumber} cancelled`,
        metadata: { reason: trimmedReason, previousStatus: artwork.status },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    await recalculateOrderProofSummary(tx, {
      shopId: input.shopId,
      orderId: group.orderId,
      actorStaffId: input.staffUserId,
    });

    return { alreadyCancelled: false as const };
  });

  return result.alreadyCancelled ? { outcome: "already_there" } : { outcome: "cancelled" };
}
