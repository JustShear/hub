import { ActorType, type OrderStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { canMoveOrderToColumn } from "~/domain/orders/workflow-transitions";
import { getBoardColumn, type BoardColumnKey } from "~/domain/orders/board-columns";
import { syncOrderLifecycleTag } from "~/domain/orders/sync-order-lifecycle-tag.server";

export type MoveOrderResult =
  | { outcome: "moved"; workflowStatus: OrderStatus }
  // Idempotent no-op — the order is already at the requested destination,
  // whether because of a duplicate/retried submission or because another
  // request already made the same move. No new ActivityEvent either way.
  | { outcome: "already_there"; workflowStatus: OrderStatus }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualWorkflowStatus: OrderStatus };

export interface MoveOrderInput {
  shopId: string;
  orderId: string;
  targetColumnKey: BoardColumnKey;
  /** The workflowStatus the client observed when it initiated the move — guards against a stale drag. */
  expectedWorkflowStatus: OrderStatus;
  staffUserId: string;
}

// The single writer of board-driven moves. Server-authoritative end to end:
// re-validates the transition against a fresh read, then either does a
// compare-and-swap workflowStatus update (for workflowStatus-driven columns)
// or syncs a real Shopify tag (for Exported for Print) — see DropAction in
// board-columns.ts for which columns use which.
export async function moveOrderWorkflowStatus(input: MoveOrderInput): Promise<MoveOrderResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: { id: true, workflowStatus: true },
  });

  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  const targetColumn = getBoardColumn(input.targetColumnKey);
  const dropAction = targetColumn.dropAction;

  if (dropAction?.type === "shopifyTag") {
    // Tag-driven columns don't have a single mutable field to dedupe an
    // "already there" retry against the way workflowStatus does — the
    // staleness guard below is what protects against a genuinely stale drag
    // (e.g. the order moved to Pack since the client last loaded the board).
    if (order.workflowStatus !== input.expectedWorkflowStatus) {
      return {
        outcome: "conflict",
        reason:
          "This order changed since you last saw it. Refresh the board to see its current state.",
        actualWorkflowStatus: order.workflowStatus,
      };
    }

    const transitionCheck = canMoveOrderToColumn(order.workflowStatus, input.targetColumnKey);
    if (!transitionCheck.allowed) {
      return { outcome: "rejected", reason: transitionCheck.reason ?? "This move isn't allowed." };
    }

    const tagResult = await syncOrderLifecycleTag({
      shopId: input.shopId,
      orderId: input.orderId,
      addTag: dropAction.addTag,
      removeTags: dropAction.removeTags,
    });

    // "partial" (one leg of the add/remove failed) still leaves the order
    // correctly placed — Exported for Print's own match condition only
    // needs the add to have landed, and its match priority already outranks
    // the columns driven by the tags removeTags targets. Only a full
    // rejection is worth surfacing as a failed move.
    if (tagResult.outcome === "rejected") {
      return { outcome: "rejected", reason: tagResult.reason };
    }

    await db.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        entityType: "ShopifyOrder",
        entityId: input.orderId,
        eventType: "workflow_status_changed",
        summary: `Moved to ${targetColumn.label} (Shopify tag "${dropAction.addTag}" applied)`,
        metadata: {
          targetColumnKey: input.targetColumnKey,
          addTag: dropAction.addTag,
          source: "kanban_board",
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    // workflowStatus never changes for a tag-driven move — the board's
    // placement comes from the tag, not this field.
    return { outcome: "moved", workflowStatus: order.workflowStatus };
  }

  const targetStatus = dropAction?.type === "workflowStatus" ? dropAction.status : undefined;

  // Checked before the expected-status comparison so an exact duplicate
  // retry of an already-successful move — the common "network retry after
  // the first response was lost" case — reports as an idempotent no-op
  // instead of a confusing conflict.
  if (targetStatus && order.workflowStatus === targetStatus) {
    return { outcome: "already_there", workflowStatus: order.workflowStatus };
  }

  if (order.workflowStatus !== input.expectedWorkflowStatus) {
    return {
      outcome: "conflict",
      reason:
        "This order changed since you last saw it. Refresh the board to see its current state.",
      actualWorkflowStatus: order.workflowStatus,
    };
  }

  const transitionCheck = canMoveOrderToColumn(order.workflowStatus, input.targetColumnKey);
  if (!transitionCheck.allowed || !targetStatus) {
    return { outcome: "rejected", reason: transitionCheck.reason ?? "This move isn't allowed." };
  }

  const now = new Date();
  const result = await db.shopifyOrder.updateMany({
    where: {
      id: input.orderId,
      shopId: input.shopId,
      workflowStatus: input.expectedWorkflowStatus,
    },
    data: { workflowStatus: targetStatus, workflowStatusChangedAt: now },
  });

  if (result.count === 0) {
    const current = await db.shopifyOrder.findFirst({
      where: { id: input.orderId, shopId: input.shopId },
      select: { workflowStatus: true },
    });
    if (current?.workflowStatus === targetStatus) {
      return { outcome: "already_there", workflowStatus: targetStatus };
    }
    return {
      outcome: "conflict",
      reason: "Someone else already moved this order. Refresh the board to see its current state.",
      actualWorkflowStatus: current?.workflowStatus ?? order.workflowStatus,
    };
  }

  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      orderId: input.orderId,
      entityType: "ShopifyOrder",
      entityId: input.orderId,
      eventType: "workflow_status_changed",
      summary: `Workflow status changed from ${order.workflowStatus} to ${targetStatus}`,
      metadata: {
        previousStatus: order.workflowStatus,
        newStatus: targetStatus,
        source: "kanban_board",
      },
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  return { outcome: "moved", workflowStatus: targetStatus };
}
