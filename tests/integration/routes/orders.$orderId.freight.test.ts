import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { action } from "~/routes/orders.$orderId.freight";
import { createFreightTestTracker } from "~/../tests/integration/domain/freight/helpers";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/orders");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("order freight action route (integration)", () => {
  const tracker = createFreightTestTracker();
  const createdStaffRoleUserIds: string[] = [];
  afterAll(async () => {
    await tracker.cleanup();
    if (createdStaffRoleUserIds.length > 0) {
      await db.staffRole.deleteMany({ where: { staffUserId: { in: createdStaffRoleUserIds } } });
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffRoleUserIds } } });
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
    createdStaffRoleUserIds.push(staffUser.id);
    return staffUser;
  }

  it("redirects a signed-out request to /login", async () => {
    const order = await tracker.createOrder();
    const formData = new FormData();
    formData.set("_intent", "createFreightShipment");

    let caught: unknown;
    try {
      await action({
        request: new Request(`http://localhost/orders/${order.id}/freight`, {
          method: "POST",
          body: formData,
        }),
        params: { orderId: order.id },
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(302);
  });

  it("returns 403 for a staff user without orders.view (PACKING_STAFF has freight_shipments.view/download but not orders.view)", async () => {
    const order = await tracker.createOrder();
    const staffUser = await createStaffUserWithRole("PACKING_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "createFreightShipment");

    let caught: unknown;
    try {
      await action({
        request: new Request(`http://localhost/orders/${order.id}/freight`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: { orderId: order.id },
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(403);
  });

  it("rejects createFreightShipment for a staff user with orders.view but without freight_shipments.create", async () => {
    const order = await tracker.createOrder();
    const staffUser = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "createFreightShipment");
    formData.set("carrierCode", "AusPost");
    formData.set("carrierServiceCode", "Standard");
    formData.set("idempotencyKey", randomUUID());

    const result = (await action({
      request: new Request(`http://localhost/orders/${order.id}/freight`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never)) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission/i);
  });

  it("rejects cancelFreightShipment for a staff user with orders.view but without freight_shipments.cancel", async () => {
    const order = await tracker.createOrder();
    const staffUser = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "cancelFreightShipment");
    formData.set("freightShipmentId", randomUUID());
    formData.set("reason", "irrelevant");

    const result = (await action({
      request: new Request(`http://localhost/orders/${order.id}/freight`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never)) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission/i);
  });

  it("returns an unknown-intent error for an unrecognised _intent", async () => {
    const order = await tracker.createOrder();
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "somethingElse");

    const result = (await action({
      request: new Request(`http://localhost/orders/${order.id}/freight`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never)) as { ok: boolean; intent: string };

    expect(result.ok).toBe(false);
    expect(result.intent).toBe("unknown");
  });

  // Real end-to-end action call for a permitted user. Starshipit credentials
  // in the test environment are deliberately fake (vitest.config.ts), so
  // this genuinely fails closed — proving the full route -> domain path
  // works honestly end to end, the same pattern as production-artwork's own
  // "performs a valid action" test but for an integration this milestone
  // cannot fake a happy path for without real sandbox credentials.
  it("performs a real createFreightShipment action end to end for a Manager, failing closed against the fake Starshipit credentials", async () => {
    const order = await tracker.createOrder();
    await tracker.createOrderLine(order.id);
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);
    const formData = new FormData();
    formData.set("_intent", "createFreightShipment");
    formData.set("carrierCode", "AusPost");
    formData.set("carrierServiceCode", "Standard");
    formData.set("idempotencyKey", randomUUID());

    const result = (await action({
      request: new Request(`http://localhost/orders/${order.id}/freight`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never)) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(await db.freightShipment.count({ where: { orderId: order.id, status: "FAILED" } })).toBe(
      1,
    );
  }, 20000);

  it("performs a real cancelFreightShipment action end to end for a Manager", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);
    const shipment = await db.freightShipment.create({
      data: {
        shopId: order.shopId,
        orderId: order.id,
        status: "PREPARING",
        idempotencyKey: randomUUID(),
        carrierCode: "AusPost",
        carrierServiceCode: "Standard",
        createdByStaffId: manager.id,
      },
    });
    const formData = new FormData();
    formData.set("_intent", "cancelFreightShipment");
    formData.set("freightShipmentId", shipment.id);
    formData.set("reason", "Order changed after label was reserved");

    const result = (await action({
      request: new Request(`http://localhost/orders/${order.id}/freight`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never)) as { ok: boolean };

    expect(result.ok).toBe(true);
    const reloaded = await db.freightShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(reloaded.status).toBe("CANCELLED");
  });
});
