import { ActorType, type Priority } from "@prisma/client";
import { db } from "~/lib/db.server";

export type UpdatePriorityResult =
  | { outcome: "updated"; priority: Priority }
  | { outcome: "already_there"; priority: Priority }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualPriority: Priority };

export interface UpdatePriorityInput {
  shopId: string;
  orderId: string;
  targetPriority: Priority;
  expectedPriority: Priority;
  reason?: string;
  staffUserId: string;
}

// SRS 13.2: HIGH requires a reason; URGENT requires a reason (and "suitable
// permission" — enforced by orders.priority.update being the one permission
// gating this action at all, since no finer-grained permission exists yet).
const PRIORITIES_REQUIRING_REASON: Priority[] = ["HIGH", "URGENT"];

// Same compare-and-swap idempotency pattern as move-order-workflow-status.server.ts.
export async function updateOrderPriority(
  input: UpdatePriorityInput,
): Promise<UpdatePriorityResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: { priority: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  if (order.priority === input.targetPriority) {
    return { outcome: "already_there", priority: order.priority };
  }

  if (order.priority !== input.expectedPriority) {
    return {
      outcome: "conflict",
      reason: "Priority changed since you last saw it. Refresh to see the current value.",
      actualPriority: order.priority,
    };
  }

  const trimmedReason = (input.reason ?? "").trim();
  if (PRIORITIES_REQUIRING_REASON.includes(input.targetPriority) && !trimmedReason) {
    return {
      outcome: "rejected",
      reason: `A reason is required when setting priority to ${input.targetPriority}.`,
    };
  }

  const result = await db.shopifyOrder.updateMany({
    where: { id: input.orderId, shopId: input.shopId, priority: input.expectedPriority },
    data: { priority: input.targetPriority },
  });

  if (result.count === 0) {
    const current = await db.shopifyOrder.findFirst({
      where: { id: input.orderId, shopId: input.shopId },
      select: { priority: true },
    });
    if (current?.priority === input.targetPriority) {
      return { outcome: "already_there", priority: input.targetPriority };
    }
    return {
      outcome: "conflict",
      reason: "Priority changed since you last saw it. Refresh to see the current value.",
      actualPriority: current?.priority ?? order.priority,
    };
  }

  await db.$transaction([
    db.orderPriorityHistory.create({
      data: {
        orderId: input.orderId,
        priority: input.targetPriority,
        reason: trimmedReason.length > 0 ? trimmedReason : null,
        setByStaffId: input.staffUserId,
      },
    }),
    db.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        entityType: "ShopifyOrder",
        entityId: input.orderId,
        eventType: "priority_changed",
        summary: `Priority changed from ${order.priority} to ${input.targetPriority}`,
        metadata: {
          previousPriority: order.priority,
          newPriority: input.targetPriority,
          reason: trimmedReason.length > 0 ? trimmedReason : null,
          source: "order_drawer",
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    }),
  ]);

  return { outcome: "updated", priority: input.targetPriority };
}
