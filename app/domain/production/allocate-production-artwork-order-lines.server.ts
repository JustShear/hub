import { ActorType, Prisma } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface ProductionArtworkOrderLineAllocationInput {
  orderLineId: string;
  quantity: number;
}

export interface SetProductionArtworkOrderLinesInput {
  shopId: string;
  productionArtworkId: string;
  allocations: ProductionArtworkOrderLineAllocationInput[];
  staffUserId: string;
}

export type SetProductionArtworkOrderLinesResult =
  { outcome: "set" } | { outcome: "rejected"; reason: string };

/**
 * Replaces the full set of order-line allocations for one production
 * artwork revision — the UI always submits the complete intended set
 * rather than incremental add/remove calls, so a full replace inside one
 * transaction is both simpler and race-free.
 */
export async function setProductionArtworkOrderLines(
  input: SetProductionArtworkOrderLinesInput,
): Promise<SetProductionArtworkOrderLinesResult> {
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

  if (input.allocations.some((a) => a.quantity <= 0)) {
    return { outcome: "rejected", reason: "Allocated quantities must be greater than zero." };
  }

  const lineIds = input.allocations.map((a) => a.orderLineId);
  const uniqueLineIds = new Set(lineIds);
  if (uniqueLineIds.size !== lineIds.length) {
    return {
      outcome: "rejected",
      reason: "The same order line can't be allocated more than once.",
    };
  }

  const lines =
    lineIds.length > 0
      ? await db.shopifyOrderLine.findMany({
          where: { id: { in: lineIds }, orderId: artwork.proofGroup.orderId },
          select: { id: true, quantity: true },
        })
      : [];
  if (lines.length !== lineIds.length) {
    return {
      outcome: "rejected",
      reason: "One or more selected order lines don't belong to this order.",
    };
  }
  const lineQuantities = new Map(lines.map((l) => [l.id, l.quantity]));
  const overAllocated = input.allocations.find(
    (a) => a.quantity > (lineQuantities.get(a.orderLineId) ?? 0),
  );
  if (overAllocated) {
    return {
      outcome: "rejected",
      reason: "An allocated quantity can't exceed the order line's own quantity.",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.productionArtworkOrderLine.deleteMany({
      where: { productionArtworkId: input.productionArtworkId },
    });
    if (input.allocations.length > 0) {
      await tx.productionArtworkOrderLine.createMany({
        data: input.allocations.map((a) => ({
          productionArtworkId: input.productionArtworkId,
          orderLineId: a.orderLineId,
          quantity: a.quantity,
        })),
      });
    }
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: artwork.proofGroup.orderId,
        entityType: "ProductionArtwork",
        entityId: artwork.id,
        eventType: "production_artwork_lines_allocated",
        summary: `Order-line allocation updated for production artwork revision ${artwork.revisionNumber} ("${artwork.proofGroup.name}")`,
        metadata: { allocations: input.allocations } as unknown as Prisma.InputJsonValue,
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
  });

  return { outcome: "set" };
}
