import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Priority } from "@prisma/client";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { loader, action } from "~/routes/orders.$orderId";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/orders");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("order drawer route (integration)", () => {
  const createdStaffUserIds: string[] = [];
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.orderNote.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.orderPriorityHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.manualOverride.deleteMany({ where: { relatedEntityId: { in: createdOrderIds } } });
      await db.orderDueDate.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.orderAssignment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffRole.deleteMany({ where: { staffUserId: { in: createdStaffUserIds } } });
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  async function createStaffUserWithRole(roleName: string) {
    const shop = await db.shop.findFirstOrThrow();
    const role = await db.role.findUniqueOrThrow({
      where: { shopId_name: { shopId: shop.id, name: roleName } },
    });
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Staff",
        passwordHash: await hashPassword("irrelevant"),
      },
    });
    await db.staffRole.create({ data: { staffUserId: staffUser.id, roleId: role.id } });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  async function createOrder() {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#drawer-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        customerName: "Test Customer",
        tags: [],
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);
    return order;
  }

  it("redirects a signed-out request to /login", async () => {
    const order = await createOrder();
    let caught: unknown;
    try {
      await loader({
        request: new Request(`http://localhost/orders/${order.id}`),
        params: { orderId: order.id },
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(302);
    expect((caught as Response).headers.get("Location")).toContain("/login");
  });

  it("returns 403 for a staff user without orders.view", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUserWithRole("PACKING_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      loader({
        request: new Request(`http://localhost/orders/${order.id}`, {
          headers: { Cookie: cookie },
        }),
        params: { orderId: order.id },
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns 404 for an order that doesn't exist", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      loader({
        request: new Request("http://localhost/orders/does-not-exist", {
          headers: { Cookie: cookie },
        }),
        params: { orderId: "does-not-exist" },
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("loads order details with permission flags reflecting the staff member's role (PRINT_STAFF: view only)", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);

    const result = await loader({
      request: new Request(`http://localhost/orders/${order.id}`, { headers: { Cookie: cookie } }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result.order.id).toBe(order.id);
    expect(result.order.orderNumber).toBe(order.orderNumber);
    expect(result.canEditAssignment).toBe(false);
    expect(result.canEditPriority).toBe(false);
    expect(result.canEditDueDates).toBe(false);
    expect(result.canViewNotes).toBe(false);
    expect(result.canCreateNotes).toBe(false);
    expect(result.canViewRawData).toBe(false);
  });

  it("grants editing and notes permissions for MANAGER, but not raw_data.view", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);

    const result = await loader({
      request: new Request(`http://localhost/orders/${order.id}`, { headers: { Cookie: cookie } }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result.canEditAssignment).toBe(true);
    expect(result.canEditPriority).toBe(true);
    expect(result.canEditDueDates).toBe(true);
    expect(result.canViewNotes).toBe(true);
    expect(result.canCreateNotes).toBe(true);
    expect(result.canViewRawData).toBe(false);
  });

  it("grants raw_data.view for ADMINISTRATOR", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUserWithRole("ADMINISTRATOR");
    const cookie = await sessionCookieFor(staffUser.id);

    const result = await loader({
      request: new Request(`http://localhost/orders/${order.id}`, { headers: { Cookie: cookie } }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result.canViewRawData).toBe(true);
  });

  it("rejects an updateAssignment action for a staff user without orders.assignment.update", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);

    const formData = new FormData();
    formData.set("_intent", "updateAssignment");
    formData.set("targetStaffUserId", staffUser.id);
    formData.set("expectedStaffUserId", "");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(await db.orderAssignment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("performs a valid updateAssignment action for a staff user with permission", async () => {
    const order = await createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);

    const formData = new FormData();
    formData.set("_intent", "updateAssignment");
    formData.set("targetStaffUserId", manager.id);
    formData.set("expectedStaffUserId", "");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    const assignment = await db.orderAssignment.findFirst({
      where: { orderId: order.id, unassignedAt: null },
    });
    expect(assignment?.staffUserId).toBe(manager.id);
  });

  it("performs a valid updatePriority action requiring a reason for URGENT", async () => {
    const order = await createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);

    const formData = new FormData();
    formData.set("_intent", "updatePriority");
    formData.set("targetPriority", Priority.URGENT);
    formData.set("expectedPriority", Priority.NORMAL);
    formData.set("reason", "Customer escalated via phone call.");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.priority).toBe(Priority.URGENT);
  });

  it("reports a stale-data conflict when submitting an outdated expectedPriority", async () => {
    const order = await createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);

    // Someone else already changed the priority to HIGH server-side.
    await db.shopifyOrder.update({ where: { id: order.id }, data: { priority: Priority.HIGH } });

    const formData = new FormData();
    formData.set("_intent", "updatePriority");
    formData.set("targetPriority", Priority.LOW);
    formData.set("expectedPriority", Priority.NORMAL);
    formData.set("reason", "");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    const unchanged = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.priority).toBe(Priority.HIGH);
  });

  it("a duplicate updatePriority submission through the route action does not duplicate history or activity", async () => {
    const order = await createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);

    function buildRequest() {
      const formData = new FormData();
      formData.set("_intent", "updatePriority");
      formData.set("targetPriority", Priority.LOW);
      formData.set("expectedPriority", Priority.NORMAL);
      formData.set("reason", "");
      return new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      });
    }

    const first = await action({
      request: buildRequest(),
      params: { orderId: order.id },
      context: {},
    } as never);
    const second = await action({
      request: buildRequest(),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(await db.orderPriorityHistory.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("performs a valid setDueDate action", async () => {
    const order = await createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);

    const formData = new FormData();
    formData.set("_intent", "setDueDate");
    formData.set("type", "DISPATCH");
    formData.set("targetDueDate", new Date("2026-09-01T00:00:00.000Z").toISOString());
    formData.set("expectedDueDate", "");
    formData.set("reason", "Confirmed with customer over email.");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(await db.orderDueDate.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("rejects a setDueDate action for a staff user without orders.due_dates.update", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);

    const formData = new FormData();
    formData.set("_intent", "setDueDate");
    formData.set("type", "DISPATCH");
    formData.set("targetDueDate", new Date("2026-09-01T00:00:00.000Z").toISOString());
    formData.set("expectedDueDate", "");
    formData.set("reason", "Should not be allowed.");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(await db.orderDueDate.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("performs a valid addNote action", async () => {
    const order = await createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);

    const formData = new FormData();
    formData.set("_intent", "addNote");
    formData.set("body", "Left a voicemail confirming the order.");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(await db.orderNote.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("rejects an empty addNote action", async () => {
    const order = await createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);

    const formData = new FormData();
    formData.set("_intent", "addNote");
    formData.set("body", "   ");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(await db.orderNote.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("rejects an addNote action for a staff user without notes.internal.create", async () => {
    const order = await createOrder();
    const staffUser = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);

    const formData = new FormData();
    formData.set("_intent", "addNote");
    formData.set("body", "Should not be allowed.");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(await db.orderNote.count({ where: { orderId: order.id } })).toBe(0);
  });
});
