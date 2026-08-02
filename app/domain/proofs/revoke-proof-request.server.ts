import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface RevokeProofRequestInput {
  shopId: string;
  proofRequestId: string;
  reason: string;
  staffUserId: string;
}

export type RevokeProofRequestResult =
  { outcome: "revoked" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

/**
 * Revoking only blocks the customer's access to the link — it never
 * changes ProofGroup/ProofVersion status (the group is still, honestly,
 * "sent, awaiting a response" until staff act on it some other way) and
 * never undoes any CustomerProofResponse already recorded. The request row
 * itself is never deleted.
 */
export async function revokeProofRequest(
  input: RevokeProofRequestInput,
): Promise<RevokeProofRequestResult> {
  const proofRequest = await db.proofRequest.findFirst({
    where: { id: input.proofRequestId, shopId: input.shopId },
  });
  if (!proofRequest) {
    return { outcome: "rejected", reason: "Proof request not found." };
  }
  if (proofRequest.revokedAt) {
    return { outcome: "already_there" };
  }
  const reason = input.reason.trim();
  if (!reason) {
    return { outcome: "rejected", reason: "A reason is required to revoke a proof request." };
  }

  const result = await db.$transaction(async (tx) => {
    const updateResult = await tx.proofRequest.updateMany({
      where: { id: proofRequest.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason, revokedByStaffId: input.staffUserId },
    });
    if (updateResult.count === 0) {
      return { revoked: false as const };
    }
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: proofRequest.orderId,
        entityType: "ProofRequest",
        entityId: proofRequest.id,
        eventType: "proof_request_revoked",
        summary: `Proof request revoked: ${reason}`,
        metadata: { reason },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return { revoked: true as const };
  });

  return result.revoked ? { outcome: "revoked" } : { outcome: "already_there" };
}
