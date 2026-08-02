import { ActorType, Prisma, type DecorationMethod } from "@prisma/client";
import { db } from "~/lib/db.server";
import { validateProductionArtworkMetadata } from "~/domain/production/eligibility";

export interface UpdateProductionArtworkInput {
  shopId: string;
  productionArtworkId: string;
  decorationMethod: DecorationMethod;
  placement: string | null;
  productionMetadata: Record<string, unknown> | null;
  staffUserId: string;
}

export type UpdateProductionArtworkResult =
  | { outcome: "updated"; validationStatus: boolean; validationMessages: string[] }
  | { outcome: "rejected"; reason: string };

export async function updateProductionArtwork(
  input: UpdateProductionArtworkInput,
): Promise<UpdateProductionArtworkResult> {
  const artwork = await db.productionArtwork.findFirst({
    where: { id: input.productionArtworkId, shopId: input.shopId },
    include: { proofGroup: { select: { id: true, orderId: true, name: true } } },
  });
  if (!artwork) {
    return { outcome: "rejected", reason: "Production artwork not found." };
  }
  if (artwork.status === "EXPORTED" || artwork.status === "CANCELLED") {
    return {
      outcome: "rejected",
      reason: "This production artwork revision can no longer be edited.",
    };
  }

  const validation = validateProductionArtworkMetadata({
    decorationMethod: input.decorationMethod,
    placement: input.placement,
  });
  const newStatus = validation.passed
    ? artwork.status === "VALIDATION_FAILED"
      ? "DRAFT"
      : artwork.status
    : "VALIDATION_FAILED";

  await db.$transaction(async (tx) => {
    await tx.productionArtwork.update({
      where: { id: artwork.id },
      data: {
        decorationMethod: input.decorationMethod,
        placement: input.placement,
        productionMetadata: input.productionMetadata
          ? (input.productionMetadata as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        validationStatus: validation.passed,
        validationMessages: validation.messages,
        status: newStatus,
      },
    });
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: artwork.proofGroup.orderId,
        entityType: "ProductionArtwork",
        entityId: artwork.id,
        eventType: "production_artwork_updated",
        summary: `Production artwork revision ${artwork.revisionNumber} updated for "${artwork.proofGroup.name}"`,
        metadata: { validationStatus: validation.passed },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
  });

  return {
    outcome: "updated",
    validationStatus: validation.passed,
    validationMessages: validation.messages,
  };
}
