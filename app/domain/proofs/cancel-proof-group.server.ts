import { ActorType, type ProofGroupStatus } from "@prisma/client";
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

// Shop-requested restriction: only a group that's been started but never
// sent to the customer can be cancelled — once it's gone out (SENT/VIEWED/
// CHANGES_REQUESTED/APPROVED/READY_FOR_EXPORT/EXPORTED_FOR_PRINT), the real
// history needs to stay intact rather than be cancelled away.
const CANCELLABLE_STATUSES: ProofGroupStatus[] = [
  "NOT_STARTED",
  "DRAFT_IN_PROGRESS",
  "READY_TO_SEND",
];

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
  if (!CANCELLABLE_STATUSES.includes(group.status)) {
    return {
      outcome: "rejected",
      reason: "Only a proof group that hasn't been sent to the customer yet can be cancelled.",
    };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required to cancel a proof group." };
  }

  const result = await db.$transaction(async (tx) => {
    const updateResult = await tx.proofGroup.updateMany({
      where: { id: input.proofGroupId, status: { in: CANCELLABLE_STATUSES } },
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
