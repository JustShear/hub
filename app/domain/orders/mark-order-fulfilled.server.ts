import { ActorType, OrderStatus } from "@prisma/client";
import { db } from "~/lib/db.server";

export type MarkOrderFulfilledResult =
  { outcome: "marked" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

export interface MarkOrderFulfilledInput {
  shopId: string;
  orderId: string;
  staffUserId: string;
}

// Statuses a manual "mark as fulfilled" must not silently override — a
// cancelled or archived order is finished for a different reason.
const BLOCKED_STATUSES: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.ARCHIVED];

// Manual escape hatch for an order the automatic Shopify sync can't resolve
// — e.g. one too old for the app's Shopify permissions to read, so the
// sweep sees "not found" and can never notice it was fulfilled. Hub-side
// only: it never writes anything to Shopify, since the order is already
// fulfilled there by the time staff reach for this.
export async function markOrderFulfilled(
  input: MarkOrderFulfilledInput,
): Promise<MarkOrderFulfilledResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: { workflowStatus: true, orderNumber: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }
  if (order.workflowStatus === OrderStatus.FULFILLED) {
    return { outcome: "already_there" };
  }
  if (BLOCKED_STATUSES.includes(order.workflowStatus)) {
    return {
      outcome: "rejected",
      reason: "A cancelled or archived order can't be marked as fulfilled.",
    };
  }

  // Compare-and-swap on the status we just read, so two people clicking at
  // once produce one transition and one event.
  const result = await db.shopifyOrder.updateMany({
    where: { id: input.orderId, shopId: input.shopId, workflowStatus: order.workflowStatus },
    data: { workflowStatus: OrderStatus.FULFILLED, workflowStatusChangedAt: new Date() },
  });
  if (result.count === 0) {
    return {
      outcome: "rejected",
      reason: "This order changed since you opened it. Refresh and try again.",
    };
  }

  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      orderId: input.orderId,
      entityType: "ShopifyOrder",
      entityId: input.orderId,
      eventType: "workflow_status_changed",
      summary: `Order ${order.orderNumber} was manually marked as fulfilled`,
      metadata: {
        previousStatus: order.workflowStatus,
        newStatus: OrderStatus.FULFILLED,
        source: "manual_mark_fulfilled",
      },
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  return { outcome: "marked" };
}
