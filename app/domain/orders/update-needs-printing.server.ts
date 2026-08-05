import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export type UpdateNeedsPrintingResult =
  | { outcome: "updated"; needsPrinting: boolean }
  | { outcome: "rejected"; reason: string };

export interface UpdateNeedsPrintingInput {
  shopId: string;
  orderId: string;
  needsPrinting: boolean;
  staffUserId: string;
}

// A simple manual staff flag ("still needs a print add-on applied") — no
// Shopify sync, no cross-field validation, so unlike priority/assignment this
// doesn't need compare-and-swap conflict handling. Still logs an
// ActivityEvent for the same reason every other board mutation does: an
// order silently changing state with no audit trail is worse than a little
// extra logging.
export async function updateOrderNeedsPrinting(
  input: UpdateNeedsPrintingInput,
): Promise<UpdateNeedsPrintingResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: { needsPrinting: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  if (order.needsPrinting === input.needsPrinting) {
    return { outcome: "updated", needsPrinting: order.needsPrinting };
  }

  await db.$transaction([
    db.shopifyOrder.update({
      where: { id: input.orderId },
      data: { needsPrinting: input.needsPrinting },
    }),
    db.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        entityType: "ShopifyOrder",
        entityId: input.orderId,
        eventType: "needs_printing_changed",
        summary: input.needsPrinting
          ? "Marked as needing printing"
          : "Unmarked as needing printing",
        metadata: { needsPrinting: input.needsPrinting, source: "kanban_board" },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    }),
  ]);

  return { outcome: "updated", needsPrinting: input.needsPrinting };
}
