import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DueDateType, OverrideType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { setOrderDueDate } from "~/domain/orders/update-due-date.server";

describe("setOrderDueDate (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.manualOverride.deleteMany({ where: { relatedEntityId: { in: createdOrderIds } } });
      await db.orderDueDate.deleteMany({ where: { orderId: { in: createdOrderIds } } });
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
        orderNumber: `#due-date-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
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

  it("sets a new due date, recording a ManualOverride and an ActivityEvent", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();
    const target = new Date("2026-08-01T00:00:00.000Z");

    const result = await setOrderDueDate({
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.INTERNAL,
      targetDueDate: target,
      expectedDueDate: null,
      reason: "Customer confirmed timeline on the phone.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "set", dueDate: target.toISOString() });
    const dueDate = await db.orderDueDate.findUniqueOrThrow({
      where: { orderId_type: { orderId: order.id, type: DueDateType.INTERNAL } },
    });
    expect(dueDate.dueDate.toISOString()).toBe(target.toISOString());
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
    const override = await db.manualOverride.findFirstOrThrow({
      where: { relatedEntityId: dueDate.id },
    });
    expect(override.overrideType).toBe(OverrideType.CHANGE_DUE_DATE);
    expect(override.reason).toBe("Customer confirmed timeline on the phone.");
  });

  it("rejects setting a due date without a reason", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();

    const result = await setOrderDueDate({
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.INTERNAL,
      targetDueDate: new Date("2026-08-01T00:00:00.000Z"),
      expectedDueDate: null,
      reason: "   ",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    expect(await db.orderDueDate.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("updates an existing due date to a new value", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();
    const original = new Date("2026-08-01T00:00:00.000Z");
    const updatedDate = new Date("2026-08-05T00:00:00.000Z");

    await setOrderDueDate({
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.DISPATCH,
      targetDueDate: original,
      expectedDueDate: null,
      reason: "Initial estimate.",
      staffUserId: staffUser.id,
    });

    const result = await setOrderDueDate({
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.DISPATCH,
      targetDueDate: updatedDate,
      expectedDueDate: original,
      reason: "Pushed out a few days at customer's request.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "set", dueDate: updatedDate.toISOString() });
    const dueDate = await db.orderDueDate.findUniqueOrThrow({
      where: { orderId_type: { orderId: order.id, type: DueDateType.DISPATCH } },
    });
    expect(dueDate.dueDate.toISOString()).toBe(updatedDate.toISOString());
  });

  it("clears an existing due date", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();
    const original = new Date("2026-08-01T00:00:00.000Z");

    await setOrderDueDate({
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.PRODUCTION,
      targetDueDate: original,
      expectedDueDate: null,
      reason: "Initial estimate.",
      staffUserId: staffUser.id,
    });

    const result = await setOrderDueDate({
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.PRODUCTION,
      targetDueDate: null,
      expectedDueDate: original,
      reason: "No longer needed — folded into dispatch date.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "set", dueDate: null });
    const dueDate = await db.orderDueDate.findUnique({
      where: { orderId_type: { orderId: order.id, type: DueDateType.PRODUCTION } },
    });
    expect(dueDate).toBeNull();
  });

  it("reports a conflict when the due date changed since the client last saw it", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();
    const actual = new Date("2026-08-01T00:00:00.000Z");

    await setOrderDueDate({
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.CUSTOMER_PROMISED,
      targetDueDate: actual,
      expectedDueDate: null,
      reason: "Initial estimate.",
      staffUserId: staffUser.id,
    });

    // Client still thinks there's no due date set.
    const result = await setOrderDueDate({
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.CUSTOMER_PROMISED,
      targetDueDate: new Date("2026-09-01T00:00:00.000Z"),
      expectedDueDate: null,
      reason: "Attempting a stale write.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "conflict", actualDueDate: actual.toISOString() });
  });

  it("treats an exact duplicate submission as an idempotent no-op with no duplicate ActivityEvent", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();
    const target = new Date("2026-08-01T00:00:00.000Z");

    const input = {
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.INTERNAL,
      targetDueDate: target,
      expectedDueDate: null,
      reason: "Initial estimate.",
      staffUserId: staffUser.id,
    };

    const first = await setOrderDueDate(input);
    expect(first.outcome).toBe("set");

    const second = await setOrderDueDate(input);
    expect(second).toMatchObject({ outcome: "already_there", dueDate: target.toISOString() });

    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("rejects an invalid date", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();

    const result = await setOrderDueDate({
      shopId: order.shopId,
      orderId: order.id,
      type: DueDateType.INTERNAL,
      targetDueDate: new Date("not-a-date"),
      expectedDueDate: null,
      reason: "Testing malformed input.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("returns rejected for a non-existent order", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const result = await setOrderDueDate({
      shopId: shop.id,
      orderId: "does-not-exist",
      type: DueDateType.INTERNAL,
      targetDueDate: new Date(),
      expectedDueDate: null,
      reason: "n/a",
      staffUserId: "does-not-exist",
    });
    expect(result.outcome).toBe("rejected");
  });
});
