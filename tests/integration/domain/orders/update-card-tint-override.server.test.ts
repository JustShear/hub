import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { updateCardTintOverride } from "~/domain/orders/update-card-tint-override.server";

describe("updateCardTintOverride (integration)", () => {
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

  async function createOrder(cardTintOverride: "PINK" | "BLUE" | "NONE" | null = null) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#card-tint-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        cardTintOverride,
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

  it("sets the override to PINK and records an ActivityEvent", async () => {
    const order = await createOrder(null);
    const staffUser = await createStaffUser();

    const result = await updateCardTintOverride({
      shopId: order.shopId,
      orderId: order.id,
      cardTintOverride: "PINK",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", cardTintOverride: "PINK" });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.cardTintOverride).toBe("PINK");

    const events = await db.activityEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "card_tint_override_changed" });
  });

  it("sets the override to BLUE", async () => {
    const order = await createOrder(null);
    const staffUser = await createStaffUser();

    const result = await updateCardTintOverride({
      shopId: order.shopId,
      orderId: order.id,
      cardTintOverride: "BLUE",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", cardTintOverride: "BLUE" });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.cardTintOverride).toBe("BLUE");
  });

  it("sets the override to NONE (forced no tint, distinct from automatic)", async () => {
    const order = await createOrder(null);
    const staffUser = await createStaffUser();

    const result = await updateCardTintOverride({
      shopId: order.shopId,
      orderId: order.id,
      cardTintOverride: "NONE",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", cardTintOverride: "NONE" });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.cardTintOverride).toBe("NONE");
  });

  it("clears the override back to automatic (null) with a passed null value", async () => {
    const order = await createOrder("PINK");
    const staffUser = await createStaffUser();

    const result = await updateCardTintOverride({
      shopId: order.shopId,
      orderId: order.id,
      cardTintOverride: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", cardTintOverride: null });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.cardTintOverride).toBeNull();
  });

  it("is an idempotent no-op with no new ActivityEvent when the value doesn't change", async () => {
    const order = await createOrder("BLUE");
    const staffUser = await createStaffUser();

    const result = await updateCardTintOverride({
      shopId: order.shopId,
      orderId: order.id,
      cardTintOverride: "BLUE",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated", cardTintOverride: "BLUE" });
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("rejects an order that doesn't exist", async () => {
    const staffUser = await createStaffUser();

    const result = await updateCardTintOverride({
      shopId: (await db.shop.findFirstOrThrow()).id,
      orderId: "does-not-exist",
      cardTintOverride: "PINK",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });
});
