import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { updateOrderAssignment } from "~/domain/orders/update-assignment.server";

describe("updateOrderAssignment (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.orderAssignment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  async function createOrder() {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#assign-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);
    return order;
  }

  async function createStaffUser(isActive = true) {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Staff",
        passwordHash: "irrelevant",
        isActive,
      },
    });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  it("assigns an unassigned order and records exactly one ActivityEvent", async () => {
    const order = await createOrder();
    const target = await createStaffUser();
    const actor = await createStaffUser();

    const result = await updateOrderAssignment({
      shopId: order.shopId,
      orderId: order.id,
      targetStaffUserId: target.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    expect(result).toMatchObject({ outcome: "updated", staffUserId: target.id });
    const assignment = await db.orderAssignment.findFirst({
      where: { orderId: order.id, unassignedAt: null },
    });
    expect(assignment?.staffUserId).toBe(target.id);
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("clears an existing assignment", async () => {
    const order = await createOrder();
    const target = await createStaffUser();
    const actor = await createStaffUser();

    await updateOrderAssignment({
      shopId: order.shopId,
      orderId: order.id,
      targetStaffUserId: target.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    const result = await updateOrderAssignment({
      shopId: order.shopId,
      orderId: order.id,
      targetStaffUserId: null,
      expectedStaffUserId: target.id,
      staffUserId: actor.id,
    });

    expect(result).toMatchObject({ outcome: "updated", staffUserId: null });
    const assignment = await db.orderAssignment.findFirst({
      where: { orderId: order.id, unassignedAt: null },
    });
    expect(assignment).toBeNull();
  });

  it("rejects assigning to an inactive staff member", async () => {
    const order = await createOrder();
    const inactive = await createStaffUser(false);
    const actor = await createStaffUser();

    const result = await updateOrderAssignment({
      shopId: order.shopId,
      orderId: order.id,
      targetStaffUserId: inactive.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    expect(await db.orderAssignment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("reports a conflict when the assignment changed since the client last saw it", async () => {
    const order = await createOrder();
    const first = await createStaffUser();
    const second = await createStaffUser();
    const actor = await createStaffUser();

    await updateOrderAssignment({
      shopId: order.shopId,
      orderId: order.id,
      targetStaffUserId: first.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    // Client still thinks the order is unassigned.
    const result = await updateOrderAssignment({
      shopId: order.shopId,
      orderId: order.id,
      targetStaffUserId: second.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    expect(result).toMatchObject({ outcome: "conflict", actualStaffUserId: first.id });
    const assignment = await db.orderAssignment.findFirst({
      where: { orderId: order.id, unassignedAt: null },
    });
    expect(assignment?.staffUserId).toBe(first.id);
  });

  it("treats an exact duplicate submission as an idempotent no-op with no duplicate ActivityEvent", async () => {
    const order = await createOrder();
    const target = await createStaffUser();
    const actor = await createStaffUser();

    const input = {
      shopId: order.shopId,
      orderId: order.id,
      targetStaffUserId: target.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    };

    const first = await updateOrderAssignment(input);
    expect(first.outcome).toBe("updated");

    const second = await updateOrderAssignment(input);
    expect(second).toMatchObject({ outcome: "already_there", staffUserId: target.id });

    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("returns rejected for a non-existent order", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const result = await updateOrderAssignment({
      shopId: shop.id,
      orderId: "does-not-exist",
      targetStaffUserId: null,
      expectedStaffUserId: null,
      staffUserId: "does-not-exist",
    });
    expect(result.outcome).toBe("rejected");
  });
});
