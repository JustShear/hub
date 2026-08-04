import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { markOrderFulfilledManually } from "~/domain/freight/mark-order-fulfilled-manually.server";
import { createFreightTestTracker } from "./helpers";

describe("markOrderFulfilledManually (integration)", () => {
  const tracker = createFreightTestTracker();
  afterAll(tracker.cleanup);

  it("rejects when the order doesn't exist", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await tracker.createStaffUser();

    const result = await markOrderFulfilledManually({
      shopId: shop.id,
      orderId: randomUUID(),
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("rejects when the order isn't ready to pack yet", async () => {
    const order = await tracker.createOrder({ workflowStatus: "NEW" });
    const staffUser = await tracker.createStaffUser();

    const result = await markOrderFulfilledManually({
      shopId: order.shopId,
      orderId: order.id,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected", reason: "This order isn't ready to pack yet." });

    const reloaded = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.workflowStatus).toBe("NEW");
  });

  // Same honest-failure convention as sync-tracking-to-shopify.test.ts: this
  // order's shopifyOrderGid is fake, so the real Shopify API call fails, but
  // never claims success — proves the failure is recorded via
  // IntegrationFailure/SHOPIFY_FULFILLMENT and workflowStatus is left untouched.
  it("against the real Shopify API with a nonexistent order, fails closed and records an IntegrationFailure without touching workflowStatus", async () => {
    const order = await tracker.createOrder({ workflowStatus: "READY_TO_PACK" });
    const staffUser = await tracker.createStaffUser();

    const result = await markOrderFulfilledManually({
      shopId: order.shopId,
      orderId: order.id,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");

    const reloaded = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloaded.workflowStatus).toBe("READY_TO_PACK");

    const failure = await db.integrationFailure.findFirst({
      where: {
        shopId: order.shopId,
        integration: "SHOPIFY_FULFILLMENT",
        action: "manual_fulfillment",
        relatedOrderId: order.id,
      },
    });
    expect(failure).not.toBeNull();
  }, 20000);
});
