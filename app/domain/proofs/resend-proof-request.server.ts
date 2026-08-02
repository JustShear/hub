import { randomUUID } from "node:crypto";
import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { dispatchQueuedKlaviyoEvent } from "~/domain/proofs/dispatch-klaviyo-event.server";

export interface ResendProofRequestInput {
  shopId: string;
  proofRequestId: string;
  staffUserId: string;
}

export type ResendProofRequestResult =
  { outcome: "resent" } | { outcome: "rejected"; reason: string };

/**
 * Resending reuses the SAME ProofRequest and the SAME token — it never
 * creates a new ProofRequest row (that's what a genuinely new proof
 * version gets instead). The raw token itself is never re-derived or
 * re-exposed here: the original KlaviyoDispatch's `eventProperties` already
 * has the correct, still-valid review URL baked in from when the request
 * was first sent, so resend just copies that forward into a new delivery
 * attempt rather than needing the raw token again.
 */
export async function resendProofRequest(
  input: ResendProofRequestInput,
): Promise<ResendProofRequestResult> {
  const proofRequest = await db.proofRequest.findFirst({
    where: { id: input.proofRequestId, shopId: input.shopId },
  });
  if (!proofRequest) {
    return { outcome: "rejected", reason: "Proof request not found." };
  }
  if (proofRequest.revokedAt) {
    return {
      outcome: "rejected",
      reason: "This proof request has been revoked — send a new one instead.",
    };
  }
  if (proofRequest.status === "COMPLETED") {
    return { outcome: "rejected", reason: "This proof request is already complete." };
  }
  if (proofRequest.tokenExpiresAt.getTime() < Date.now()) {
    return {
      outcome: "rejected",
      reason: "This proof request has expired — send a new one instead.",
    };
  }

  const originalDispatch = await db.klaviyoDispatch.findFirst({
    where: { proofRequestId: proofRequest.id },
    orderBy: { queuedAt: "asc" },
  });
  if (!originalDispatch) {
    return {
      outcome: "rejected",
      reason: "No original delivery record found for this proof request.",
    };
  }

  const dispatch = await db.$transaction(async (tx) => {
    const created = await tx.klaviyoDispatch.create({
      data: {
        shopId: input.shopId,
        eventType: "PROOF_SENT",
        klaviyoMetricName: originalDispatch.klaviyoMetricName,
        recipientEmail: originalDispatch.recipientEmail,
        orderId: originalDispatch.orderId,
        proofRequestId: proofRequest.id,
        eventProperties: originalDispatch.eventProperties as object,
        status: "QUEUED",
        idempotencyKey: `proof_sent:${proofRequest.id}:resend:${randomUUID()}`,
      },
    });
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: proofRequest.orderId,
        entityType: "ProofRequest",
        entityId: proofRequest.id,
        eventType: "proof_request_resent",
        summary: `Proof request resent to ${proofRequest.customerEmail}`,
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return created;
  });

  await dispatchQueuedKlaviyoEvent(dispatch.id);

  return { outcome: "resent" };
}
