import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";

vi.mock("~/adapters/storage/get-storage-adapter.server", () => ({
  storageAdapter: {
    getObjectBuffer: vi.fn((key: string) =>
      key.startsWith("missing/")
        ? Promise.reject(new Error("no such key"))
        : Promise.resolve(Buffer.from(`image-bytes-for-${key}`)),
    ),
  },
}));

const { loader: proofsLoader, action: proofsAction } =
  await import("~/routes/api.customer-account.proofs");
const { loader: imageLoader } = await import("~/routes/api.customer-account.proof-image.$assetId");
const { buildProofImageUrl } = await import("~/domain/customer-account/signed-image-url.server");

// Must match the values vitest.config.ts injects.
const CLIENT_ID = "test-extension-client-id";
const SECRET = "test_webhook_secret_for_hmac_verification";

function sessionToken(shopDomain: string, customerGid: string | undefined, extra = {}) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    dest: `https://${shopDomain}`,
    aud: CLIENT_ID,
    sub: customerGid,
    exp: now + 300,
    nbf: now - 5,
    ...extra,
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function proofsRequest(token: string | null) {
  return new Request("https://hub.test/api/customer-account/proofs", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// The loaders' `Route.LoaderArgs` carry router internals these routes never read.
type LoaderArgs = Parameters<typeof proofsLoader>[0];
const callProofs = (token: string | null) =>
  proofsLoader({ request: proofsRequest(token), params: {}, context: {} } as LoaderArgs);

describe("customer-account endpoints (integration)", () => {
  const runId = randomUUID().slice(0, 8);
  const customerA = `7${Date.now()}`;
  const customerB = `8${Date.now()}`;
  const orderIds: string[] = [];
  let shopId: string;
  let shopDomain: string;
  let approvedAssetA: string;
  let draftAssetA: string;
  let approvedAssetB: string;
  let missingFileAssetA: string;

  async function makeOrderWithProof(
    customerId: string,
    orderNumber: string,
    versionStatus: "APPROVED" | "CHANGES_REQUESTED" | "DRAFT",
    storageKey: string,
  ) {
    const order = await db.shopifyOrder.create({
      data: {
        shopId,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber,
        shopifyCreatedAt: new Date(),
        rawPayload: {},
        customerName: "Secret Name",
        customerEmail: `secret-${randomUUID()}@example.test`,
        customerShopifyGid: `gid://shopify/Customer/${customerId}`,
      },
    });
    orderIds.push(order.id);
    const group = await db.proofGroup.create({
      data: {
        orderId: order.id,
        name: "Left chest",
        decorationMethod: "EMBROIDERY",
        status: "APPROVED",
      },
    });
    const version = await db.proofVersion.create({
      data: {
        proofGroupId: group.id,
        versionNumber: 1,
        status: versionStatus,
        createdByStaffId: "staff",
        internalNote: "INTERNAL ONLY",
        approvedAt: versionStatus === "APPROVED" ? new Date() : null,
      },
    });
    const asset = await db.proofAsset.create({
      data: { proofVersionId: version.id, storageKey, isPrimary: true, mimeType: "image/png" },
    });
    return asset.id;
  }

  beforeAll(async () => {
    const shop = await db.shop.findFirstOrThrow();
    shopId = shop.id;
    shopDomain = shop.shopifyDomain;
    approvedAssetA = await makeOrderWithProof(
      customerA,
      `#CA-${runId}-A1`,
      "APPROVED",
      "proofs/a1.png",
    );
    draftAssetA = await makeOrderWithProof(customerA, `#CA-${runId}-A2`, "DRAFT", "proofs/a2.png");
    missingFileAssetA = await makeOrderWithProof(
      customerA,
      `#CA-${runId}-A3`,
      "APPROVED",
      "missing/a3.png",
    );
    approvedAssetB = await makeOrderWithProof(
      customerB,
      `#CA-${runId}-B1`,
      "APPROVED",
      "proofs/b1.png",
    );
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

  describe("GET /api/customer-account/proofs", () => {
    it("rejects a request with no token, a bad token, or a token without a customer", async () => {
      for (const token of [
        null,
        "garbage",
        sessionToken(shopDomain, undefined),
        sessionToken("other-shop.myshopify.com", `gid://shopify/Customer/${customerA}`),
      ]) {
        const response = await callProofs(token);
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthorized" });
      }
    });

    it("returns only the signed-in customer's approved proofs, with a safe, whitelisted shape", async () => {
      const response = await callProofs(
        sessionToken(shopDomain, `gid://shopify/Customer/${customerA}`),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const body = (await response.json()) as { proofs: Record<string, unknown>[] };
      const numbers = body.proofs.map((p) => p.orderNumber);
      expect(numbers).toContain(`#CA-${runId}-A1`);
      expect(numbers).toContain(`#CA-${runId}-A3`);
      // Not approved -> not shown. Another customer's order -> not shown.
      expect(numbers).not.toContain(`#CA-${runId}-A2`);
      expect(numbers).not.toContain(`#CA-${runId}-B1`);

      for (const proof of body.proofs) {
        expect(Object.keys(proof).sort()).toEqual(
          ["approvedAt", "artworkName", "id", "imageUrl", "method", "orderNumber"].sort(),
        );
      }
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("INTERNAL ONLY");
      expect(raw).not.toContain("Secret Name");
      expect(raw).not.toContain("secret-");

      const first = body.proofs.find((p) => p.orderNumber === `#CA-${runId}-A1`);
      expect(String(first?.imageUrl)).toContain(
        `/api/customer-account/proof-image/${approvedAssetA}?`,
      );
    });

    it("returns an empty list for a customer with no orders", async () => {
      const response = await callProofs(sessionToken(shopDomain, "gid://shopify/Customer/1"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ proofs: [] });
    });

    it("answers the CORS preflight (no auth header) through the LOADER, as the router does", async () => {
      const preflight = await proofsLoader({
        request: new Request("https://hub.test/api/customer-account/proofs", {
          method: "OPTIONS",
          headers: { "Access-Control-Request-Headers": "authorization" },
        }),
        params: {},
        context: {},
      } as LoaderArgs);
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    });

    it("answers the CORS preflight and refuses other methods", async () => {
      const preflight = await proofsAction({
        request: new Request("https://hub.test/api/customer-account/proofs", { method: "OPTIONS" }),
        params: {},
        context: {},
      } as Parameters<typeof proofsAction>[0]);
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");

      const post = await proofsAction({
        request: new Request("https://hub.test/api/customer-account/proofs", { method: "POST" }),
        params: {},
        context: {},
      } as Parameters<typeof proofsAction>[0]);
      expect(post.status).toBe(405);
    });
  });

  describe("GET /api/customer-account/proof-image/:assetId", () => {
    function link(assetId: string, customerId: string) {
      return new URL(
        buildProofImageUrl({ baseUrl: "https://hub.test", secret: SECRET, assetId, customerId }),
      );
    }
    const callImage = (url: URL, assetId: string) =>
      imageLoader({
        request: new Request(url),
        params: { assetId },
        context: {},
      } as Parameters<typeof imageLoader>[0]);

    it("serves the image to the customer it belongs to, with defensive headers", async () => {
      const response = await callImage(link(approvedAssetA, customerA), approvedAssetA);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Cache-Control")).toContain("private");
      expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
        "image-bytes-for-proofs/a1.png",
      );
    });

    it("404s for another customer's file even with a validly signed link for the wrong customer", async () => {
      // A genuine signature, but for customer A asking about customer B's asset.
      const response = await callImage(link(approvedAssetB, customerA), approvedAssetB);
      expect(response.status).toBe(404);
    });

    it("404s for a version that is not approved", async () => {
      const response = await callImage(link(draftAssetA, customerA), draftAssetA);
      expect(response.status).toBe(404);
    });

    it("404s for tampered, expired, missing-signature and unknown-asset links alike", async () => {
      const tampered = link(approvedAssetA, customerA);
      tampered.searchParams.set("cid", customerB);
      expect((await callImage(tampered, approvedAssetA)).status).toBe(404);

      const expired = new URL(
        buildProofImageUrl({
          baseUrl: "https://hub.test",
          secret: SECRET,
          assetId: approvedAssetA,
          customerId: customerA,
          nowMs: Date.now() - 2 * 60 * 60 * 1000,
        }),
      );
      expect((await callImage(expired, approvedAssetA)).status).toBe(404);

      const unsigned = new URL(
        `https://hub.test/api/customer-account/proof-image/${approvedAssetA}`,
      );
      expect((await callImage(unsigned, approvedAssetA)).status).toBe(404);

      const unknown = randomUUID();
      expect((await callImage(link(unknown, customerA), unknown)).status).toBe(404);
    });

    it("404s (not 500) when the stored file is missing from storage", async () => {
      const response = await callImage(link(missingFileAssetA, customerA), missingFileAssetA);
      expect(response.status).toBe(404);
    });
  });
});
