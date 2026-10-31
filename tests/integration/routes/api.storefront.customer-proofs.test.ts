import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { loader } from "~/routes/api.storefront.customer-proofs";

const API_KEY = "test-storefront-api-key-0123456789abcdef";

type LoaderArgs = Parameters<typeof loader>[0];
const call = (query: string, authorization?: string) =>
  loader({
    request: new Request(`https://hub.test/api/storefront/customer-proofs${query}`, {
      headers: authorization ? { Authorization: authorization } : {},
    }),
    params: {},
    context: {},
  } as LoaderArgs);

describe("GET /api/storefront/customer-proofs (integration)", () => {
  const runId = randomUUID().slice(0, 8);
  const customerA = `3${Date.now()}`;
  const customerB = `2${Date.now()}`;
  const orderIds: string[] = [];
  let versionA: string;
  let versionB: string;

  beforeAll(async () => {
    const shop = await db.shop.findFirstOrThrow();
    const make = async (customerId: string, label: string) => {
      const order = await db.shopifyOrder.create({
        data: {
          shopId: shop.id,
          shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
          orderNumber: `#SF-${runId}-${label}`,
          shopifyCreatedAt: new Date(),
          rawPayload: {},
          customerShopifyGid: `gid://shopify/Customer/${customerId}`,
          customerEmail: `private-${label}@example.test`,
        },
      });
      orderIds.push(order.id);
      const group = await db.proofGroup.create({
        data: {
          orderId: order.id,
          name: `Logo ${label}`,
          decorationMethod: "EMBROIDERY",
          status: "APPROVED",
        },
      });
      const version = await db.proofVersion.create({
        data: {
          proofGroupId: group.id,
          versionNumber: 1,
          status: "APPROVED",
          createdByStaffId: "staff",
          approvedAt: new Date(),
          internalNote: "INTERNAL ONLY",
        },
      });
      await db.proofAsset.create({
        data: {
          proofVersionId: version.id,
          storageKey: `proof-versions/${randomUUID()}.png`,
          isPrimary: true,
          mimeType: "image/png",
        },
      });
      return version.id;
    };
    versionA = await make(customerA, "A");
    versionB = await make(customerB, "B");
  });

  afterAll(async () => {
    const groups = await db.proofGroup.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const versions = await db.proofVersion.findMany({
      where: { proofGroupId: { in: groups.map((g) => g.id) } },
      select: { id: true },
    });
    const versionIds = versions.map((v) => v.id);
    await db.proofAsset.deleteMany({ where: { proofVersionId: { in: versionIds } } });
    await db.proofVersion.deleteMany({ where: { id: { in: versionIds } } });
    await db.proofGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
    await db.shopifyOrder.deleteMany({ where: { id: { in: orderIds } } });
  });

  it("rejects a request with no key, a wrong key, or a key of the wrong shape", async () => {
    for (const authorization of [
      undefined,
      "Bearer nope",
      `Basic ${API_KEY}`,
      `Bearer ${API_KEY}x`,
    ]) {
      const response = await call(`?customerId=${customerA}`, authorization);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("rejects a missing or malformed customer id", async () => {
    for (const query of [
      "",
      "?customerId=",
      "?customerId=abc",
      "?customerId=1;DROP",
      "?customerId=gid://shopify/Customer/1",
    ]) {
      const response = await call(query, `Bearer ${API_KEY}`);
      expect(response.status).toBe(400);
    }
  });

  it("returns only that customer's approved proofs, with the proof id the options app saves on the order", async () => {
    const response = await call(`?customerId=${customerA}`, `Bearer ${API_KEY}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = (await response.json()) as { proofs: Record<string, unknown>[] };
    const ids = body.proofs.map((p) => p.id);
    expect(ids).toContain(versionA);
    expect(ids).not.toContain(versionB);

    const mine = body.proofs.find((p) => p.id === versionA);
    expect(Object.keys(mine ?? {}).sort()).toEqual(
      ["approvedAt", "artworkName", "id", "imageUrl", "method", "orderNumber"].sort(),
    );
    expect(String(mine?.imageUrl)).toContain("/api/customer-account/proof-image/");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("INTERNAL ONLY");
    expect(raw).not.toContain("private-");
  });

  it("returns an empty list for a customer with no approved proofs", async () => {
    const response = await call("?customerId=1", `Bearer ${API_KEY}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ proofs: [] });
  });
});
