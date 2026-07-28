import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { loader as listLoader } from "~/routes/dev.orders";
import { loader as detailLoader } from "~/routes/dev.orders.$orderId";

async function getShop() {
  return db.shop.findFirstOrThrow();
}

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

function requestWithCookie(url: string, cookie: string): Request {
  return new Request(url, { headers: { Cookie: cookie } });
}

describe("dev.orders routes (integration)", () => {
  const createdStaffUserIds: string[] = [];
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      const lines = await db.shopifyOrderLine.findMany({
        where: { orderId: { in: createdOrderIds } },
      });
      const lineIds = lines.map((l) => l.id);
      await db.shopifyLineProperty.deleteMany({ where: { orderLineId: { in: lineIds } } });
      await db.shopifyOrderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffRole.deleteMany({ where: { staffUserId: { in: createdStaffUserIds } } });
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  async function createStaffUserWithRole(roleName: string) {
    const shop = await getShop();
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

  it("redirects signed-out requests to /login", async () => {
    // requireStaffUser throws the redirect Response rather than returning it.
    let caught: unknown;
    try {
      await listLoader({
        request: new Request("http://localhost/dev/orders"),
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

  it("returns 403 for a signed-in staff user without raw_data.view", async () => {
    const staffUser = await createStaffUserWithRole("PACKING_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      listLoader({
        request: requestWithCookie("http://localhost/dev/orders", cookie),
        params: {},
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("lists imported orders for a staff user with raw_data.view", async () => {
    const shop = await getShop();
    const staffUser = await createStaffUserWithRole("ADMINISTRATOR");
    const cookie = await sessionCookieFor(staffUser.id);

    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: "#8001",
        shopifyCreatedAt: new Date(),
        customerEmail: "list-test@example.com",
        tags: [],
        rawPayload: { hello: "world" },
      },
    });
    createdOrderIds.push(order.id);

    const result = await listLoader({
      request: requestWithCookie("http://localhost/dev/orders", cookie),
      params: {},
      context: {},
    } as never);

    expect(result.orders.some((o) => o.id === order.id)).toBe(true);
  });

  it("shows the raw payload, line properties, and linked artwork asset on the detail page", async () => {
    const shop = await getShop();
    const staffUser = await createStaffUserWithRole("ADMINISTRATOR");
    const cookie = await sessionCookieFor(staffUser.id);

    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: "#8002",
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: { secretField: "raw-payload-marker" },
      },
    });
    createdOrderIds.push(order.id);

    const uploadUrl = `https://cdn.shopify.com/s/files/1/inspector-${randomUUID()}.png`;
    const asset = await db.customerArtworkAsset.create({
      data: { shopId: shop.id, sourceUrl: uploadUrl, sourceType: "EXTERNAL_REFERENCE" },
    });

    const line = await db.shopifyOrderLine.create({
      data: {
        orderId: order.id,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Embroidered Cap",
        quantity: 1,
      },
    });

    await db.shopifyLineProperty.create({
      data: {
        orderLineId: line.id,
        name: "Logo Upload",
        value: uploadUrl,
        sortOrder: 0,
        detectedType: "FILE_UPLOAD",
        parsedAssetId: asset.id,
      },
    });

    await db.artworkOrderLineLink.create({ data: { assetId: asset.id, orderLineId: line.id } });

    const result = await detailLoader({
      request: requestWithCookie(`http://localhost/dev/orders/${order.id}`, cookie),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result.order.rawPayload).toEqual({ secretField: "raw-payload-marker" });
    expect(result.order.lines).toHaveLength(1);
    expect(result.order.lines[0]?.properties[0]).toMatchObject({
      name: "Logo Upload",
      detectedType: "FILE_UPLOAD",
    });
    expect(result.order.lines[0]?.artworkLinks[0]?.asset.sourceUrl).toBe(uploadUrl);

    await db.artworkOrderLineLink.deleteMany({ where: { assetId: asset.id } });
    await db.customerArtworkAsset.delete({ where: { id: asset.id } });
  });

  it("returns 404 for an order belonging to a different shop", async () => {
    const staffUser = await createStaffUserWithRole("ADMINISTRATOR");
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      detailLoader({
        request: requestWithCookie("http://localhost/dev/orders/does-not-exist", cookie),
        params: { orderId: "does-not-exist" },
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });
});
