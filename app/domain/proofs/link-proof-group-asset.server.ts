import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";

export interface LinkProofGroupAssetInput {
  shopId: string;
  proofGroupId: string;
  assetId: string;
  staffUserId: string;
}

export type LinkProofGroupAssetResult =
  { outcome: "linked" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

// This link never touches ArtworkOrderLineLink — the asset's original
// order-line association is untouched by linking it to a proof group too.
export async function linkProofGroupAsset(
  input: LinkProofGroupAssetInput,
): Promise<LinkProofGroupAssetResult> {
  const group = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
  });
  if (!group) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }
  if (group.status === "CANCELLED") {
    return { outcome: "rejected", reason: "This proof group is cancelled." };
  }

  const asset = await db.customerArtworkAsset.findFirst({
    where: { id: input.assetId, shopId: input.shopId },
    select: { id: true },
  });
  if (!asset) {
    return { outcome: "rejected", reason: "That artwork asset doesn't belong to this shop." };
  }

  const existing = await db.proofGroupArtworkAsset.findUnique({
    where: { proofGroupId_assetId: { proofGroupId: input.proofGroupId, assetId: input.assetId } },
  });
  if (existing) {
    return { outcome: "already_there" };
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.proofGroupArtworkAsset.create({
        data: {
          proofGroupId: input.proofGroupId,
          assetId: input.assetId,
          linkedByStaffId: input.staffUserId,
        },
      });
      await tx.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: group.orderId,
          entityType: "ProofGroup",
          entityId: group.id,
          eventType: "proof_group_asset_linked",
          summary: `Artwork asset linked to proof group "${group.name}"`,
          metadata: { assetId: input.assetId },
          actorStaffId: input.staffUserId,
          actorType: ActorType.STAFF,
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return { outcome: "already_there" };
    }
    throw error;
  }

  return { outcome: "linked" };
}

export interface UnlinkProofGroupAssetInput {
  shopId: string;
  proofGroupId: string;
  assetId: string;
  staffUserId: string;
}

export type UnlinkProofGroupAssetResult =
  { outcome: "unlinked" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function unlinkProofGroupAsset(
  input: UnlinkProofGroupAssetInput,
): Promise<UnlinkProofGroupAssetResult> {
  const group = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
  });
  if (!group) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }
  if (group.status === "CANCELLED") {
    return { outcome: "rejected", reason: "This proof group is cancelled." };
  }

  const result = await db.$transaction(async (tx) => {
    const deleteResult = await tx.proofGroupArtworkAsset.deleteMany({
      where: { proofGroupId: input.proofGroupId, assetId: input.assetId },
    });
    if (deleteResult.count === 0) {
      return { removed: false as const };
    }
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: group.orderId,
        entityType: "ProofGroup",
        entityId: group.id,
        eventType: "proof_group_asset_unlinked",
        summary: `Artwork asset unlinked from proof group "${group.name}"`,
        metadata: { assetId: input.assetId },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return { removed: true as const };
  });

  return result.removed ? { outcome: "unlinked" } : { outcome: "already_there" };
}
