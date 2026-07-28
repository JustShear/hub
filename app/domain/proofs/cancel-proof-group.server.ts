import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";

export interface CancelProofGroupInput {
  shopId: string;
  proofGroupId: string;
  reason: string;
  staffUserId: string;
}

export type CancelProofGroupResult =
  { outcome: "cancelled" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

// Milestone 08 only ever reaches NOT_STARTED / DRAFT_IN_PROGRESS /
// READY_TO_SEND / NO_PROOF_REQUIRED before cancellation — none of those
// represent an approved, sent, or exported item, so no override framework
// is needed to cancel them here. A future milestone that introduces
// APPROVED/SENT/EXPORTED_FOR_PRINT groups must add that guard before this
// function can be reused to cancel one of those.
export async function cancelProofGroup(
  input: CancelProofGroupInput,
): Promise<CancelProofGroupResult> {
  const group = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
  });
  if (!group) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }
  if (group.status === "CANCELLED") {
    return { outcome: "already_there" };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required to cancel a proof group." };
  }

  const result = await db.$transaction(async (tx) => {
    const updateResult = await tx.proofGroup.updateMany({
      where: { id: input.proofGroupId, status: { not: "CANCELLED" } },
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

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: group.orderId,
        entityType: "ProofGroup",
        entityId: group.id,
        eventType: "proof_group_cancelled",
        summary: `Proof group "${group.name}" cancelled`,
        metadata: { reason: trimmedReason, previousStatus: group.status },
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
