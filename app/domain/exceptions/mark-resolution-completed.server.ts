import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface MarkResolutionCompletedInput {
  shopId: string;
  resolutionId: string;
  staffUserId: string;
}

export type MarkResolutionCompletedResult =
  { outcome: "completed" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

/**
 * A plain staff toggle confirming a decided resolution was actually carried
 * out externally (refund processed in Shopify, reprint physically done,
 * exchange mailed) — no type-specific auto-derivation this milestone (e.g.
 * tying REPRINT/EXCHANGE completion to its linked ProductionJob finishing is
 * a natural future enhancement, not built now — see technical-debt).
 */
export async function markResolutionCompleted(
  input: MarkResolutionCompletedInput,
): Promise<MarkResolutionCompletedResult> {
  const resolution = await db.exceptionCaseResolution.findFirst({
    where: { id: input.resolutionId, exceptionCase: { shopId: input.shopId } },
    include: { exceptionCase: true },
  });
  if (!resolution) {
    return { outcome: "rejected", reason: "Resolution not found." };
  }
  if (resolution.status === "COMPLETED") {
    return { outcome: "already_there" };
  }

  await db.$transaction(async (tx) => {
    const updateResult = await tx.exceptionCaseResolution.updateMany({
      where: { id: input.resolutionId, status: "PENDING" },
      data: { status: "COMPLETED", completedByStaffId: input.staffUserId, completedAt: new Date() },
    });
    if (updateResult.count === 0) {
      return;
    }
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: resolution.exceptionCase.orderId,
        entityType: "ExceptionCase",
        entityId: resolution.exceptionCaseId,
        eventType: "exception_case_resolution_completed",
        summary: `Resolution for exception case ${resolution.exceptionCase.caseNumber} marked completed`,
        metadata: { resolutionId: resolution.id, resolutionType: resolution.resolutionType },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
  });

  return { outcome: "completed" };
}
