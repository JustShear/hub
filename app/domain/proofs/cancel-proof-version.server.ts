import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";

export interface CancelProofVersionInput {
  shopId: string;
  proofVersionId: string;
  reason: string;
  staffUserId: string;
}

export type CancelProofVersionResult =
  { outcome: "cancelled" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function cancelProofVersion(
  input: CancelProofVersionInput,
): Promise<CancelProofVersionResult> {
  const version = await db.proofVersion.findFirst({
    where: { id: input.proofVersionId, proofGroup: { order: { shopId: input.shopId } } },
    include: { proofGroup: true },
  });
  if (!version) {
    return { outcome: "rejected", reason: "Proof version not found." };
  }
  if (version.status === "CANCELLED") {
    return { outcome: "already_there" };
  }
  if (version.status === "SUPERSEDED") {
    return { outcome: "rejected", reason: "A superseded version can no longer be cancelled." };
  }
  if (version.status !== "DRAFT" && version.status !== "READY_TO_SEND") {
    return {
      outcome: "rejected",
      reason: "This proof version can't be cancelled from its current status.",
    };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required to cancel a proof version." };
  }

  const group = version.proofGroup;

  const result = await db.$transaction(async (tx) => {
    const updateResult = await tx.proofVersion.updateMany({
      where: { id: version.id, status: version.status },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: trimmedReason,
        cancelledByStaffId: input.staffUserId,
      },
    });
    if (updateResult.count === 0) {
      return { alreadyDone: true as const };
    }

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: group.orderId,
        entityType: "ProofVersion",
        entityId: version.id,
        eventType: "proof_version_cancelled",
        summary: `Proof version ${version.versionNumber} for "${group.name}" cancelled`,
        metadata: { reason: trimmedReason, previousStatus: version.status },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    // Cancelling the group's current version leaves it with no usable
    // version — revert to NOT_STARTED rather than resurrecting an earlier,
    // already-superseded version.
    if (group.status === "READY_TO_SEND" || group.status === "DRAFT_IN_PROGRESS") {
      await tx.proofGroup.update({ where: { id: group.id }, data: { status: "NOT_STARTED" } });
    }

    await recalculateOrderProofSummary(tx, {
      shopId: input.shopId,
      orderId: group.orderId,
      actorStaffId: input.staffUserId,
    });

    return { alreadyDone: false as const };
  });

  return result.alreadyDone ? { outcome: "already_there" } : { outcome: "cancelled" };
}
