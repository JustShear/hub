import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { evaluateReadyForExportEligibility } from "~/domain/production/eligibility";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";

export interface MarkProductionArtworkReadyInput {
  shopId: string;
  productionArtworkId: string;
  staffUserId: string;
}

export type MarkProductionArtworkReadyResult =
  | { outcome: "ready" }
  | { outcome: "already_there" }
  | { outcome: "rejected"; reason: string; issues?: string[] };

export async function markProductionArtworkReady(
  input: MarkProductionArtworkReadyInput,
): Promise<MarkProductionArtworkReadyResult> {
  const artwork = await db.productionArtwork.findFirst({
    where: { id: input.productionArtworkId, shopId: input.shopId },
    include: {
      proofGroup: { select: { id: true, orderId: true, name: true, status: true } },
      orderLineAllocations: { select: { id: true } },
    },
  });
  if (!artwork) {
    return { outcome: "rejected", reason: "Production artwork not found." };
  }
  if (artwork.status === "READY_FOR_EXPORT") {
    return { outcome: "already_there" };
  }

  const eligibility = evaluateReadyForExportEligibility({
    artworkStatus: artwork.status,
    validationStatus: artwork.validationStatus,
    hasStoredFile: true,
    allocatedLineCount: artwork.orderLineAllocations.length,
  });
  if (!eligibility.eligible) {
    return {
      outcome: "rejected",
      reason: "This production artwork revision isn't ready for export yet.",
      issues: eligibility.reasons,
    };
  }

  const group = artwork.proofGroup;

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.productionArtwork.updateMany({
      where: { id: artwork.id, status: { in: ["DRAFT", "VALIDATION_FAILED"] } },
      data: { status: "READY_FOR_EXPORT" },
    });
    if (updateResult.count === 0) {
      return { alreadyDone: true as const };
    }

    // Only the group's currently-active revision drives the group's own
    // status — a superseded/cancelled revision reaching this point would be
    // a logic error upstream, not something to silently promote from.
    // EXPORTED_FOR_PRINT is included because a corrected revision prepared
    // after the group's prior revision was already exported re-enters the
    // same READY_FOR_EXPORT staging state, ready for its own re-export.
    await tx.proofGroup.updateMany({
      where: {
        id: group.id,
        status: { in: ["APPROVED", "NO_PROOF_REQUIRED", "EXPORTED_FOR_PRINT"] },
      },
      data: { status: "READY_FOR_EXPORT" },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: group.orderId,
        entityType: "ProductionArtwork",
        entityId: artwork.id,
        eventType: "production_artwork_marked_ready",
        summary: `Production artwork revision ${artwork.revisionNumber} for "${group.name}" marked ready for export`,
        metadata: { revisionNumber: artwork.revisionNumber },
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
