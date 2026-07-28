import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { addOrderNote, MAX_NOTE_LENGTH } from "~/domain/orders/add-note.server";

describe("addOrderNote (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.orderNote.deleteMany({ where: { orderId: { in: createdOrderIds } } });
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
        orderNumber: `#note-test-${randomUUID()}`,
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

  it("creates a note and exactly one ActivityEvent", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();

    const result = await addOrderNote({
      shopId: order.shopId,
      orderId: order.id,
      body: "Called the customer to confirm delivery address.",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("created");
    const notes = await db.orderNote.findMany({ where: { orderId: order.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toBe("Called the customer to confirm delivery address.");
    expect(notes[0]?.visibility).toBe("INTERNAL");
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("rejects an empty note", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();

    const result = await addOrderNote({
      shopId: order.shopId,
      orderId: order.id,
      body: "   ",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    expect(await db.orderNote.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("rejects a note longer than the maximum length", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();

    const result = await addOrderNote({
      shopId: order.shopId,
      orderId: order.id,
      body: "x".repeat(MAX_NOTE_LENGTH + 1),
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("treats an exact duplicate resubmission within the duplicate window as a no-op, not a second note", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUser();
    const input = {
      shopId: order.shopId,
      orderId: order.id,
      body: "Same note, submitted twice by an impatient double-click.",
      staffUserId: staffUser.id,
    };

    const first = await addOrderNote(input);
    expect(first.outcome).toBe("created");

    const second = await addOrderNote(input);
    expect(second).toMatchObject({
      outcome: "duplicate",
      noteId: (first as { noteId: string }).noteId,
    });

    expect(await db.orderNote.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("returns rejected for a non-existent order", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const result = await addOrderNote({
      shopId: shop.id,
      orderId: "does-not-exist",
      body: "This should never be saved.",
      staffUserId: "does-not-exist",
    });
    expect(result.outcome).toBe("rejected");
  });
});
