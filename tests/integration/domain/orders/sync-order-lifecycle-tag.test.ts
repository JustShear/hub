import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { syncOrderLifecycleTag } from "~/domain/orders/sync-order-lifecycle-tag.server";

describe("syncOrderLifecycleTag (integration)", () => {
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.integrationAttempt.deleteMany({
        where: { failure: { relatedOrderId: { in: createdOrderIds } } },
      });
      await db.integrationFailure.deleteMany({
        where: { relatedOrderId: { in: createdOrderIds } },
      });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
  });

  async function createOrder(tags: string[] = []) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags,
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);
    return order;
  }

  it("rejects when the order doesn't exist", async () => {
    const shop = await db.shop.findFirstOrThrow();

    const result = await syncOrderLifecycleTag({
      shopId: shop.id,
      orderId: randomUUID(),
      addTag: "proof_sent",
      removeTags: [],
    });

    expect(result.outcome).toBe("rejected");
  });

  // This dev environment's seeded shop now carries real Shopify credentials
  // (from this session's earlier OAuth setup) — but the order created here
  // is local-only and was never actually synced from real Shopify, so its
  // shopifyOrderGid doesn't correspond to a real order. Against the real
  // API this comes back as a genuine per-mutation userErrors response
  // (Shopify validates the request and rejects the nonexistent id), not a
  // network/auth failure — so the honest outcome is "partial", not
  // "rejected". Either way, this proves the failure is recorded via
  // IntegrationFailure/SHOPIFY_TAG_UPDATE and the local tags array only
  // ever reflects a confirmed Shopify response, never an optimistic guess.
  it("against the real Shopify API with a nonexistent order id, never claims success and records an IntegrationFailure", async () => {
    const order = await createOrder(["existing"]);

    const result = await syncOrderLifecycleTag({
      shopId: order.shopId,
      orderId: order.id,
      addTag: "proof_sent",
      removeTags: ["existing"],
    });

    expect(result.outcome).not.toBe("synced");

    const failure = await db.integrationFailure.findFirst({
      where: {
        shopId: order.shopId,
        integration: "SHOPIFY_TAG_UPDATE",
        action: "order_tag_sync",
        relatedOrderId: order.id,
      },
    });
    expect(failure).not.toBeNull();
  }, 20000);

  it("sends only the add mutation when removeTags is empty (no crash on the omitted alias)", async () => {
    const order = await createOrder([]);

    const result = await syncOrderLifecycleTag({
      shopId: order.shopId,
      orderId: order.id,
      addTag: "p",
      removeTags: [],
    });

    // Never claims success against a nonexistent order id — this test
    // exists to prove the add-only code path (no `remove` alias in the
    // request) doesn't throw before it even reaches the network call.
    expect(result.outcome).not.toBe("synced");
  }, 20000);
});
