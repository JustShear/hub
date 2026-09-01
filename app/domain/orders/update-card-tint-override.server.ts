import { ActorType, type CardTintOverride } from "@prisma/client";
import { db } from "~/lib/db.server";

export type UpdateCardTintOverrideResult =
  | { outcome: "updated"; cardTintOverride: CardTintOverride | null }
  | { outcome: "rejected"; reason: string };

export interface UpdateCardTintOverrideInput {
  shopId: string;
  orderId: string;
  /** null clears the override, returning the card to automatic tinting. */
  cardTintOverride: CardTintOverride | null;
  staffUserId: string;
}

const SUMMARY: Record<CardTintOverride | "AUTO", string> = {
  PINK: "Card colour manually set to pink",
  BLUE: "Card colour manually set to blue",
  NONE: "Card colour manually forced to no tint",
  AUTO: "Card colour override cleared — back to automatic",
};

// A manual staff override for the Kanban card's tint — no Shopify sync, no
// cross-field validation, so unlike priority/assignment this doesn't need
// compare-and-swap conflict handling. Lets staff correct the tile when an
// order changes after the fact and the automatic embroidery/decoration/
// upload signals go stale (see board-query.server.ts). Still logs an
// ActivityEvent for the same reason every other board mutation does: an
// order silently changing state with no audit trail is worse than a little
// extra logging.
export async function updateCardTintOverride(
  input: UpdateCardTintOverrideInput,
): Promise<UpdateCardTintOverrideResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: { cardTintOverride: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  if (order.cardTintOverride === input.cardTintOverride) {
    return { outcome: "updated", cardTintOverride: order.cardTintOverride };
  }

  await db.$transaction([
    db.shopifyOrder.update({
      where: { id: input.orderId },
      data: { cardTintOverride: input.cardTintOverride },
    }),
    db.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        entityType: "ShopifyOrder",
        entityId: input.orderId,
        eventType: "card_tint_override_changed",
        summary: SUMMARY[input.cardTintOverride ?? "AUTO"],
        metadata: { cardTintOverride: input.cardTintOverride, source: "kanban_board" },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    }),
  ]);

  return { outcome: "updated", cardTintOverride: input.cardTintOverride };
}
