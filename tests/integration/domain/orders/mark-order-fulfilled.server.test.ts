import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { markOrderFulfilled } from "~/domain/orders/mark-order-fulfilled.server";
import { createFreightTestTracker } from "../freight/helpers";

describe("markOrderFulfilled (integration)", () => {
  const tracker = createFreightTestTracker();
  afterAll(tracker.cleanup);

  it("moves an active order to FULFILLED and records who did it", async () => {
    const order = await tracker.createOrder({ workflowStatus: "READY_TO_PACK" });
    const staff = await tracker.createStaffUser();

    const result = await markOrderFulfilled({
      shopId: order.shopId,
      orderId: order.id,
      staffUserId: staff.id,
    });
    expect(result).toEqual({ outcome: "marked" });

    const after = await db.shopifyOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { activity: true },
    });
    expect(after.workflowStatus).toBe("FULFILLED");
    expect(after.workflowStatusChangedAt).not.toBeNull();
    expect(after.activity).toHaveLength(1);
    expect(after.activity[0]?.summary).toMatch(/manually marked as fulfilled/);
    expect(after.activity[0]?.actorStaffId).toBe(staff.id);
  });

  it("also works for an order on hold", async () => {
    const order = await tracker.createOrder({ workflowStatus: "ON_HOLD" });
    const staff = await tracker.createStaffUser();
    const result = await markOrderFulfilled({
      shopId: order.shopId,
      orderId: order.id,
      staffUserId: staff.id,
    });
    expect(result.outcome).toBe("marked");
  });

  it("is idempotent and writes no second event", async () => {
    const order = await tracker.createOrder({ workflowStatus: "FULFILLED" });
    const staff = await tracker.createStaffUser();
    const result = await markOrderFulfilled({
      shopId: order.shopId,
      orderId: order.id,
      staffUserId: staff.id,
    });
    expect(result).toEqual({ outcome: "already_there" });
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("refuses a cancelled order", async () => {
    const order = await tracker.createOrder({ workflowStatus: "CANCELLED" });
    const staff = await tracker.createStaffUser();
    const result = await markOrderFulfilled({
      shopId: order.shopId,
      orderId: order.id,
      staffUserId: staff.id,
    });
    expect(result.outcome).toBe("rejected");
    const after = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.workflowStatus).toBe("CANCELLED");
  });

  it("rejects an unknown order id", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const result = await markOrderFulfilled({
      shopId: shop.id,
      orderId: randomUUID(),
      staffUserId: "unused",
    });
    expect(result).toEqual({ outcome: "rejected", reason: "Order not found." });
  });
});
