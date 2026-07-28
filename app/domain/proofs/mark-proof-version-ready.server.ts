import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { OPEN_STATUSES } from "~/domain/integrations/record-failure.server";
import { validateProofGroupReadiness } from "~/domain/proofs/readiness";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";

export interface MarkProofVersionReadyInput {
  shopId: string;
  proofVersionId: string;
  staffUserId: string;
}

export type MarkProofVersionReadyResult =
  | { outcome: "ready" }
  | { outcome: "already_there" }
  | { outcome: "rejected"; reason: string; issues?: string[] };

// A version is only ever the group's "current" one while it's DRAFT —
// createProofVersion immediately marks any prior DRAFT/READY_TO_SEND
// version SUPERSEDED, so reaching this function with status DRAFT already
// guarantees it's the latest.
export async function markProofVersionReady(
  input: MarkProofVersionReadyInput,
): Promise<MarkProofVersionReadyResult> {
  const version = await db.proofVersion.findFirst({
    where: { id: input.proofVersionId, proofGroup: { order: { shopId: input.shopId } } },
    include: {
      proofGroup: { include: { proofRequirement: true, orderLines: true } },
      assets: true,
    },
  });
  if (!version) {
    return { outcome: "rejected", reason: "Proof version not found." };
  }
  if (version.status === "READY_TO_SEND") {
    return { outcome: "already_there" };
  }
  if (version.status !== "DRAFT") {
    return { outcome: "rejected", reason: "Only a draft version can be marked ready to send." };
  }

  const group = version.proofGroup;
  if (group.status === "CANCELLED") {
    return { outcome: "rejected", reason: "This proof group is cancelled." };
  }

  const openFailureCount = await db.integrationFailure.count({
    where: { relatedProofGroupId: group.id, status: { in: OPEN_STATUSES } },
  });

  const readiness = validateProofGroupReadiness({
    name: group.name,
    placement: group.placement,
    decorationMethod: group.decorationMethod,
    requirementValue: group.proofRequirement?.value ?? "UNDETERMINED",
    linkedLineCount: group.orderLines.length,
    currentVersion: { status: "DRAFT", hasStoredFile: version.assets.length > 0 },
    hasOpenIntegrationFailure: openFailureCount > 0,
  });

  if (!readiness.ready) {
    return {
      outcome: "rejected",
      reason: "This proof version isn't ready yet.",
      issues: readiness.issues,
    };
  }

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.proofVersion.updateMany({
      where: { id: version.id, status: "DRAFT" },
      data: { status: "READY_TO_SEND" },
    });
    if (updateResult.count === 0) {
      return { alreadyDone: true as const };
    }

    await tx.proofGroup.update({ where: { id: group.id }, data: { status: "READY_TO_SEND" } });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: group.orderId,
        entityType: "ProofVersion",
        entityId: version.id,
        eventType: "proof_version_marked_ready",
        summary: `Proof version ${version.versionNumber} for "${group.name}" marked ready to send`,
        metadata: { versionNumber: version.versionNumber },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    await recalculateOrderProofSummary(tx, {
      shopId: input.shopId,
      orderId: group.orderId,
      actorStaffId: input.staffUserId,
    });

    return { alreadyDone: false as const };
  });

  return transactionResult.alreadyDone ? { outcome: "already_there" } : { outcome: "ready" };
}
