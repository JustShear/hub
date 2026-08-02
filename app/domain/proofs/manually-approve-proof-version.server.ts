import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";

export interface ManuallyApproveProofVersionInput {
  shopId: string;
  proofVersionId: string;
  /** Required — this bypasses the customer's own token-based response, so the record must say why. */
  reason: string;
  staffUserId: string;
}

export type ManuallyApproveProofVersionResult =
  { outcome: "approved" } | { outcome: "rejected"; reason: string };

// Thrown inside the transaction when a concurrent action (a customer
// response landing at the same moment, or the version otherwise moving on)
// won the race — caught and converted to a clean rejection.
class AlreadyResolvedError extends Error {}

/**
 * Lets staff record a proof as approved without the customer ever completing
 * the token-based flow — e.g. the customer approved by phone or in person.
 * Mirrors the state transition recordCustomerProofResponse.server.ts makes
 * for an APPROVED response, but is always recorded as a ManualOverride since
 * it's a deliberate substitute for the customer's own action, never a silent
 * equivalent of it.
 */
export async function manuallyApproveProofVersion(
  input: ManuallyApproveProofVersionInput,
): Promise<ManuallyApproveProofVersionResult> {
  if (!input.reason.trim()) {
    return { outcome: "rejected", reason: "A reason is required to manually approve a proof." };
  }

  const version = await db.proofVersion.findFirst({
    where: { id: input.proofVersionId, proofGroup: { order: { shopId: input.shopId } } },
    include: { proofGroup: true },
  });
  if (!version) {
    return { outcome: "rejected", reason: "Proof version not found." };
  }
  if (version.status !== "SENT" && version.status !== "VIEWED") {
    return {
      outcome: "rejected",
      reason:
        "This proof isn't awaiting a customer response — it may already be resolved, or a newer version may exist.",
    };
  }

  try {
    await db.$transaction(async (tx) => {
      const versionUpdate = await tx.proofVersion.updateMany({
        where: { id: version.id, status: { in: ["SENT", "VIEWED"] } },
        data: { status: "APPROVED", respondedAt: new Date(), approvedAt: new Date() },
      });
      if (versionUpdate.count === 0) {
        throw new AlreadyResolvedError();
      }

      await tx.proofGroup.update({
        where: { id: version.proofGroupId },
        data: { status: "APPROVED" },
      });

      await tx.manualOverride.create({
        data: {
          shopId: input.shopId,
          overrideType: "MANUAL_PROOF_APPROVAL",
          relatedEntityType: "ProofVersion",
          relatedEntityId: version.id,
          previousValue: { status: version.status },
          newValue: { status: "APPROVED" },
          reason: input.reason.trim(),
          staffUserId: input.staffUserId,
        },
      });

      await tx.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: version.proofGroup.orderId,
          entityType: "ProofGroup",
          entityId: version.proofGroupId,
          eventType: "proof_group_approved",
          summary: `Staff manually approved "${version.proofGroup.name}" (version ${version.versionNumber})`,
          metadata: { proofVersionId: version.id, reason: input.reason.trim() },
          actorStaffId: input.staffUserId,
          actorType: ActorType.STAFF,
        },
      });

      // Same completion rollup recordCustomerProofResponse.server.ts applies
      // — a request is only COMPLETED once every included group's response
      // has reached a terminal state for the exact version sent.
      const requestGroups = await tx.proofRequestGroup.findMany({
        where: { proofVersionId: version.id },
        select: { proofRequestId: true },
      });
      const proofRequestIds = [...new Set(requestGroups.map((g) => g.proofRequestId))];
      for (const proofRequestId of proofRequestIds) {
        const allLinks = await tx.proofRequestGroup.findMany({
          where: { proofRequestId },
          include: { proofVersion: { select: { status: true } } },
        });
        const allResolved = allLinks.every(
          (link) =>
            link.proofVersion.status === "APPROVED" ||
            link.proofVersion.status === "CHANGES_REQUESTED",
        );
        const someResolved = allLinks.some(
          (link) =>
            link.proofVersion.status === "APPROVED" ||
            link.proofVersion.status === "CHANGES_REQUESTED",
        );
        if (allResolved) {
          await tx.proofRequest.updateMany({
            where: {
              id: proofRequestId,
              status: { in: ["SENT", "VIEWED", "PARTIALLY_RESPONDED"] },
            },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
        } else if (someResolved) {
          await tx.proofRequest.updateMany({
            where: { id: proofRequestId, status: { in: ["SENT", "VIEWED"] } },
            data: { status: "PARTIALLY_RESPONDED" },
          });
        }
      }

      await recalculateOrderProofSummary(tx, {
        shopId: input.shopId,
        orderId: version.proofGroup.orderId,
        actorStaffId: input.staffUserId,
      });
    });
  } catch (error) {
    if (error instanceof AlreadyResolvedError) {
      return {
        outcome: "rejected",
        reason:
          "This proof isn't awaiting a customer response — it may already be resolved, or a newer version may exist.",
      };
    }
    throw error;
  }

  return { outcome: "approved" };
}
