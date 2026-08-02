import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { localDiskStorageAdapter } from "~/adapters/storage/local-disk-storage.server";
import { loader } from "~/routes/freight-shipments.$freightShipmentId.label";
import { createFreightTestTracker } from "~/../tests/integration/domain/freight/helpers";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/orders");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("freight label download route (integration)", () => {
  const tracker = createFreightTestTracker();
  const createdStaffRoleUserIds: string[] = [];
  const createdStorageKeys: string[] = [];
  afterAll(async () => {
    await tracker.cleanup();
    for (const key of createdStorageKeys) {
      await localDiskStorageAdapter.deleteObject(key);
    }
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

  async function createShipmentWithLabel(shopId: string, orderId: string, staffUserId: string) {
    const key = `freight-shipments/${orderId}/${randomUUID()}.pdf`;
    await localDiskStorageAdapter.putObject({ key, body: Buffer.from("%PDF-fake-label") });
    createdStorageKeys.push(key);
    return db.freightShipment.create({
      data: {
        shopId,
        orderId,
        status: "CREATED",
        idempotencyKey: randomUUID(),
        carrierCode: "AusPost",
        carrierServiceCode: "Standard",
        labelStorageKey: key,
        createdByStaffId: staffUserId,
      },
    });
  }

  it("redirects a signed-out request to /login", async () => {
    let caught: unknown;
    try {
      await loader({
        request: new Request(`http://localhost/freight-shipments/${randomUUID()}/label`),
        params: { freightShipmentId: randomUUID() },
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(302);
  });

  it("returns 403 for a staff user without freight_shipments.download", async () => {
    const staffUser = await createStaffUserWithRole("ARTWORK_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);

    let caught: unknown;
    try {
      await loader({
        request: new Request(`http://localhost/freight-shipments/${randomUUID()}/label`, {
          headers: { Cookie: cookie },
        }),
        params: { freightShipmentId: randomUUID() },
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(403);
  });

  it("returns 404 for a non-existent freight shipment", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);

    let caught: unknown;
    try {
      await loader({
        request: new Request(`http://localhost/freight-shipments/${randomUUID()}/label`, {
          headers: { Cookie: cookie },
        }),
        params: { freightShipmentId: randomUUID() },
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(404);
  });

  it("streams the PDF, sets the right headers, and increments the download count for a Manager (freight_shipments.download)", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);
    const shipment = await createShipmentWithLabel(order.shopId, order.id, manager.id);

    const response = (await loader({
      request: new Request(`http://localhost/freight-shipments/${shipment.id}/label`, {
        headers: { Cookie: cookie },
      }),
      params: { freightShipmentId: shipment.id },
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain(
      `freight-label-${shipment.id}.pdf`,
    );
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.toString()).toBe("%PDF-fake-label");

    const reloaded = await db.freightShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(reloaded.downloadCount).toBe(1);
    expect(reloaded.lastDownloadedAt).not.toBeNull();
  });

  it("also allows a Packing Staff user (view/download only) to download a label", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const packingStaff = await createStaffUserWithRole("PACKING_STAFF");
    const cookie = await sessionCookieFor(packingStaff.id);
    const shipment = await createShipmentWithLabel(order.shopId, order.id, manager.id);

    const response = (await loader({
      request: new Request(`http://localhost/freight-shipments/${shipment.id}/label`, {
        headers: { Cookie: cookie },
      }),
      params: { freightShipmentId: shipment.id },
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(200);
  });
});
