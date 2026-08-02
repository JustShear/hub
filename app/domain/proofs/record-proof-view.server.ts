import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { resolveProofRequestByToken } from "~/auth/proof-token.server";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";

export type RecordProofViewResult =
  | { outcome: "recorded" }
  | { outcome: "not_found" }
  | { outcome: "revoked" }
  | { outcome: "expired" };

/**
 * Called from a safe client-side event fired after the portal has actually
 * rendered in a browser (see routes/proof.$token.tsx) — never from the
 * loader's own GET, so a mail-security scanner following the link (which
 * only ever issues a GET and never executes page JS) cannot register a
 * "view." Idempotent and cheap to call repeatedly: only the FIRST call ever
 * transitions a group SENT -> VIEWED or writes an ActivityEvent; every
 * later call just bumps lastViewedAt/viewCount, so a customer reopening the
 * same link ten times doesn't produce ten activity rows.
 */
export async function recordProofView(rawToken: string): Promise<RecordProofViewResult> {
  const resolved = await resolveProofRequestByToken(rawToken);
  if (resolved.outcome !== "valid") {
    return resolved.outcome === "not_found"
      ? { outcome: "not_found" }
      : { outcome: resolved.outcome };
  }
  const proofRequest = resolved.proofRequest;

  await db.$transaction(async (tx) => {
    const isFirstView = await tx.proofRequest.updateMany({
      where: { id: proofRequest.id, firstViewedAt: null },
      data: { firstViewedAt: new Date() },
    });

    await tx.proofRequest.update({
      where: { id: proofRequest.id },
      data: { lastViewedAt: new Date(), viewCount: { increment: 1 } },
    });

    if (isFirstView.count === 0) {
      // Not the first view of this request — group-level SENT -> VIEWED
      // already happened (or never applies), and a second ActivityEvent
      // for "viewed again" would just be noise.
      return;
    }

    const groupLinks = await tx.proofRequestGroup.findMany({
      where: { proofRequestId: proofRequest.id },
      select: { proofGroupId: true, proofVersionId: true },
    });

    const groupUpdate = await tx.proofGroup.updateMany({
      where: { id: { in: groupLinks.map((g) => g.proofGroupId) }, status: "SENT" },
      data: { status: "VIEWED" },
    });
    await tx.proofVersion.updateMany({
      where: { id: { in: groupLinks.map((g) => g.proofVersionId) }, status: "SENT" },
      data: { status: "VIEWED", viewedAt: new Date() },
    });

    if (groupUpdate.count > 0) {
      await tx.activityEvent.create({
        data: {
          shopId: proofRequest.shopId,
          orderId: proofRequest.orderId,
          entityType: "ProofRequest",
          entityId: proofRequest.id,
          eventType: "proof_request_viewed",
          summary: "Customer opened the proof review page for the first time",
          actorType: ActorType.CUSTOMER,
        },
      });
    }

    await tx.proofRequest.updateMany({
      where: { id: proofRequest.id, status: "SENT" },
      data: { status: "VIEWED" },
    });

    await recalculateOrderProofSummary(tx, {
      shopId: proofRequest.shopId,
      orderId: proofRequest.orderId,
      actorStaffId: null,
    });
  });

  return { outcome: "recorded" };
}
