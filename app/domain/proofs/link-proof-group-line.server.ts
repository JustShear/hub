import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";

export interface LinkProofGroupLineInput {
  shopId: string;
  proofGroupId: string;
  orderLineId: string;
  staffUserId: string;
}

export type LinkProofGroupLineResult =
  { outcome: "linked" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function linkProofGroupLine(
  input: LinkProofGroupLineInput,
): Promise<LinkProofGroupLineResult> {
  const group = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
  });
  if (!group) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }
  if (group.status === "CANCELLED") {
    return { outcome: "rejected", reason: "This proof group is cancelled." };
  }

  // Scoped to the SAME order as the proof group — the one place cross-order
  // line linking is rejected outright, per the milestone's own requirement.
  const line = await db.shopifyOrderLine.findFirst({
    where: { id: input.orderLineId, orderId: group.orderId },
    select: { id: true, quantity: true },
  });
  if (!line) {
    return { outcome: "rejected", reason: "That order line doesn't belong to this order." };
  }

  const existing = await db.proofGroupOrderLine.findUnique({
    where: {
      proofGroupId_orderLineId: {
        proofGroupId: input.proofGroupId,
        orderLineId: input.orderLineId,
      },
    },
  });
  if (existing) {
    return { outcome: "already_there" };
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.proofGroupOrderLine.create({
        data: {
          proofGroupId: input.proofGroupId,
          orderLineId: input.orderLineId,
          quantity: line.quantity,
        },
      });
      await tx.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: group.orderId,
          entityType: "ProofGroup",
          entityId: group.id,
          eventType: "proof_group_line_linked",
          summary: `Order line linked to proof group "${group.name}"`,
          metadata: { orderLineId: input.orderLineId },
          actorStaffId: input.staffUserId,
          actorType: ActorType.STAFF,
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      // A concurrent request linked the same line a moment earlier — treat
      // as an idempotent no-op rather than surfacing a false error.
      return { outcome: "already_there" };
    }
    throw error;
  }

  return { outcome: "linked" };
}

export interface UnlinkProofGroupLineInput {
  shopId: string;
  proofGroupId: string;
  orderLineId: string;
  staffUserId: string;
}

export type UnlinkProofGroupLineResult =
  { outcome: "unlinked" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export async function unlinkProofGroupLine(
  input: UnlinkProofGroupLineInput,
): Promise<UnlinkProofGroupLineResult> {
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
    const deleteResult = await tx.proofGroupOrderLine.deleteMany({
      where: { proofGroupId: input.proofGroupId, orderLineId: input.orderLineId },
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
        eventType: "proof_group_line_unlinked",
        summary: `Order line unlinked from proof group "${group.name}"`,
        metadata: { orderLineId: input.orderLineId },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return { removed: true as const };
  });

  return result.removed ? { outcome: "unlinked" } : { outcome: "already_there" };
}
