import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Priority } from "@prisma/client";
import { db } from "~/lib/db.server";
import { updateOrderPriority } from "~/domain/orders/update-priority.server";

describe("updateOrderPriority (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.orderPriorityHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  async function createOrder(priority: Priority = Priority.NORMAL) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#priority-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        priority,
      },
    });
    createdOrderIds.push(order.id);
    return order;
  }

  async function createStaffUser() {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Staff",
        passwordHash: "irrelevant",
      },
    });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  it("updates priority and records exactly one ActivityEvent and one history row", async () => {
    const order = await createOrder(Priority.NORMAL);
    const staffUser = await createStaffUser();

    const result = await updateOrderPriority({
      shopId: order.shopId,
      orderId: order.id,
      targetPriority: Priority.LOW,
      expectedPriority: Priority.NORMAL,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", priority: Priority.LOW });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.priority).toBe(Priority.LOW);
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.orderPriorityHistory.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("rejects HIGH without a reason", async () => {
    const order = await createOrder(Priority.NORMAL);
    const staffUser = await createStaffUser();

    const result = await updateOrderPriority({
      shopId: order.shopId,
      orderId: order.id,
      targetPriority: Priority.HIGH,
      expectedPriority: Priority.NORMAL,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    const unchanged = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.priority).toBe(Priority.NORMAL);
  });

  it("rejects URGENT without a reason", async () => {
    const order = await createOrder(Priority.NORMAL);
    const staffUser = await createStaffUser();

    const result = await updateOrderPriority({
      shopId: order.shopId,
      orderId: order.id,
      targetPriority: Priority.URGENT,
      expectedPriority: Priority.NORMAL,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("accepts HIGH with a reason and stores it on the history row", async () => {
    const order = await createOrder(Priority.NORMAL);
    const staffUser = await createStaffUser();

    const result = await updateOrderPriority({
      shopId: order.shopId,
      orderId: order.id,
      targetPriority: Priority.HIGH,
      expectedPriority: Priority.NORMAL,
      reason: "Client called asking for a rush.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", priority: Priority.HIGH });
    const history = await db.orderPriorityHistory.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(history.reason).toBe("Client called asking for a rush.");
  });

  it("reports a conflict when priority changed since the client last saw it", async () => {
    const order = await createOrder(Priority.HIGH);
    const staffUser = await createStaffUser();

    const result = await updateOrderPriority({
      shopId: order.shopId,
      orderId: order.id,
      targetPriority: Priority.LOW,
      expectedPriority: Priority.NORMAL,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "conflict", actualPriority: Priority.HIGH });
    const unchanged = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.priority).toBe(Priority.HIGH);
  });

  it("treats an exact duplicate submission as an idempotent no-op with no duplicate ActivityEvent", async () => {
    const order = await createOrder(Priority.NORMAL);
    const staffUser = await createStaffUser();

    const input = {
      shopId: order.shopId,
      orderId: order.id,
      targetPriority: Priority.LOW,
      expectedPriority: Priority.NORMAL,
      staffUserId: staffUser.id,
    };

    const first = await updateOrderPriority(input);
    expect(first.outcome).toBe("updated");

    const second = await updateOrderPriority(input);
    expect(second).toMatchObject({ outcome: "already_there", priority: Priority.LOW });

    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.orderPriorityHistory.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("returns rejected for a non-existent order", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const result = await updateOrderPriority({
      shopId: shop.id,
      orderId: "does-not-exist",
      targetPriority: Priority.LOW,
      expectedPriority: Priority.NORMAL,
      staffUserId: "does-not-exist",
    });
    expect(result.outcome).toBe("rejected");
  });
});
