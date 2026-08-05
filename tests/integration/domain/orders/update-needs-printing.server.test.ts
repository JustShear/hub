import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { updateOrderNeedsPrinting } from "~/domain/orders/update-needs-printing.server";

describe("updateOrderNeedsPrinting (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  async function createOrder(needsPrinting = false) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#needs-printing-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        needsPrinting,
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

  it("sets needsPrinting to true and records an ActivityEvent", async () => {
    const order = await createOrder(false);
    const staffUser = await createStaffUser();

    const result = await updateOrderNeedsPrinting({
      shopId: order.shopId,
      orderId: order.id,
      needsPrinting: true,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", needsPrinting: true });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.needsPrinting).toBe(true);

    const events = await db.activityEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "needs_printing_changed" });
  });

  it("clears needsPrinting back to false", async () => {
    const order = await createOrder(true);
    const staffUser = await createStaffUser();

    const result = await updateOrderNeedsPrinting({
      shopId: order.shopId,
      orderId: order.id,
      needsPrinting: false,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", needsPrinting: false });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.needsPrinting).toBe(false);
  });

  it("is an idempotent no-op with no new ActivityEvent when the value doesn't change", async () => {
    const order = await createOrder(true);
    const staffUser = await createStaffUser();

    const result = await updateOrderNeedsPrinting({
      shopId: order.shopId,
      orderId: order.id,
      needsPrinting: true,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", needsPrinting: true });
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("rejects an order that doesn't exist", async () => {
    const staffUser = await createStaffUser();

    const result = await updateOrderNeedsPrinting({
      shopId: (await db.shop.findFirstOrThrow()).id,
      orderId: "does-not-exist",
      needsPrinting: true,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });
});
