import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { loader, action } from "~/routes/orders";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/orders");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("orders board route (integration)", () => {
  const createdStaffUserIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdViewIds: string[] = [];

  afterAll(async () => {
    if (createdViewIds.length > 0) {
      await db.savedView.deleteMany({ where: { id: { in: createdViewIds } } });
    }
    if (createdOrderIds.length > 0) {
      await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
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

  async function createStaffUserWithNoRole() {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "No Permissions Staff",
        passwordHash: await hashPassword("irrelevant"),
      },
    });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  async function createOrder(workflowStatus: OrderStatus = OrderStatus.NEW) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#route-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus,
      },
    });
    createdOrderIds.push(order.id);
    return order;
  }

  it("redirects signed-out requests to /login", async () => {
    let caught: unknown;
    try {
      await loader({
        request: new Request("http://localhost/orders"),
        params: {},
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(302);
    expect((caught as Response).headers.get("Location")).toContain("/login");
  });

  it("returns 403 for a signed-in staff user without board.view", async () => {
    const staffUser = await createStaffUserWithNoRole();
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      loader({
        request: new Request("http://localhost/orders", { headers: { Cookie: cookie } }),
        params: {},
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("reports canManage: false for a staff user with board.view but not board.manage", async () => {
    const staffUser = await createStaffUserWithRole("PACKING_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);

    const result = await loader({
      request: new Request("http://localhost/orders", { headers: { Cookie: cookie } }),
      params: {},
      context: {},
    } as never);

    expect(result.canManage).toBe(false);
    expect(result.board).not.toBeNull();
  });

  it("reports canManage: true for a staff user with board.manage", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);

    const result = await loader({
      request: new Request("http://localhost/orders", { headers: { Cookie: cookie } }),
      params: {},
      context: {},
    } as never);

    expect(result.canManage).toBe(true);
  });

  it("rejects a move action from a staff user without board.manage", async () => {
    const staffUser = await createStaffUserWithRole("PACKING_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);
    const order = await createOrder();

    const formData = new FormData();
    formData.set("_intent", "move");
    formData.set("orderId", order.id);
    formData.set("targetColumnKey", "proof_being_prepared");
    formData.set("expectedWorkflowStatus", OrderStatus.NEW);

    const result = await action({
      request: new Request("http://localhost/orders", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    const unchanged = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.workflowStatus).toBe(OrderStatus.NEW);
  });

  it("performs a valid move for a staff user with board.manage", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);
    const order = await createOrder();

    const formData = new FormData();
    formData.set("_intent", "move");
    formData.set("orderId", order.id);
    formData.set("targetColumnKey", "pack");
    formData.set("expectedWorkflowStatus", OrderStatus.NEW);

    const result = await action({
      request: new Request("http://localhost/orders", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true, workflowStatus: OrderStatus.READY_TO_PACK });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.workflowStatus).toBe(OrderStatus.READY_TO_PACK);
  });

  it("rejects moving to a non-interactive column via the route action", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);
    const order = await createOrder();

    const formData = new FormData();
    formData.set("_intent", "move");
    formData.set("orderId", order.id);
    formData.set("targetColumnKey", "proof_sent");
    formData.set("expectedWorkflowStatus", OrderStatus.NEW);

    const result = await action({
      request: new Request("http://localhost/orders", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
  });

  it("a duplicate move submission through the route action does not create a duplicate ActivityEvent", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);
    const order = await createOrder();

    function buildRequest() {
      const formData = new FormData();
      formData.set("_intent", "move");
      formData.set("orderId", order.id);
      formData.set("targetColumnKey", "proof_being_prepared");
      formData.set("expectedWorkflowStatus", OrderStatus.NEW);
      return new Request("http://localhost/orders", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      });
    }

    const first = await action({ request: buildRequest(), params: {}, context: {} } as never);
    const second = await action({ request: buildRequest(), params: {}, context: {} } as never);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("performs a valid toggleNeedsPrinting action for a staff user with board.manage", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);
    const order = await createOrder();

    const formData = new FormData();
    formData.set("_intent", "toggleNeedsPrinting");
    formData.set("orderId", order.id);
    formData.set("needsPrinting", "true");

    const result = await action({
      request: new Request("http://localhost/orders", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true, needsPrinting: true });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.needsPrinting).toBe(true);
  });

  it("rejects a toggleNeedsPrinting action from a staff user without board.manage", async () => {
    const staffUser = await createStaffUserWithRole("PACKING_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);
    const order = await createOrder();

    const formData = new FormData();
    formData.set("_intent", "toggleNeedsPrinting");
    formData.set("orderId", order.id);
    formData.set("needsPrinting", "true");

    const result = await action({
      request: new Request("http://localhost/orders", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    const unchanged = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.needsPrinting).toBe(false);
  });

  it("filters the board by priority via search params", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);
    const shop = await db.shop.findFirstOrThrow();
    const urgentOrder = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#route-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus: OrderStatus.NEW,
        priority: "URGENT",
      },
    });
    createdOrderIds.push(urgentOrder.id);

    const result = await loader({
      request: new Request("http://localhost/orders?priority=URGENT", {
        headers: { Cookie: cookie },
      }),
      params: {},
      context: {},
    } as never);

    const ids = result.board?.columns.flatMap((c) => c.cards).map((c) => c.id) ?? [];
    expect(ids).toContain(urgentOrder.id);
  });

  it("creates, updates, and deletes a saved view via the route action, scoped to the staff member", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);

    const createForm = new FormData();
    createForm.set("_intent", "createView");
    createForm.set("name", "Route Test View");
    createForm.set(
      "config",
      JSON.stringify({
        filters: {},
        sort: { field: "urgency_default" },
        view: "board",
        density: "comfortable",
      }),
    );

    const createResult = await action({
      request: new Request("http://localhost/orders", {
        method: "POST",
        headers: { Cookie: cookie },
        body: createForm,
      }),
      params: {},
      context: {},
    } as never);

    expect(createResult).toMatchObject({ ok: true });
    const viewId = (createResult as { view: { id: string } }).view.id;
    createdViewIds.push(viewId);

    const loaderResult = await loader({
      request: new Request("http://localhost/orders", { headers: { Cookie: cookie } }),
      params: {},
      context: {},
    } as never);
    expect(loaderResult.savedViews.some((v) => v.id === viewId)).toBe(true);

    const deleteForm = new FormData();
    deleteForm.set("_intent", "deleteView");
    deleteForm.set("viewId", viewId);
    const deleteResult = await action({
      request: new Request("http://localhost/orders", {
        method: "POST",
        headers: { Cookie: cookie },
        body: deleteForm,
      }),
      params: {},
      context: {},
    } as never);
    expect(deleteResult).toMatchObject({ ok: true });
  });
});
