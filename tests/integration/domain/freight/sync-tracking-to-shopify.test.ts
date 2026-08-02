import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { syncFreightTrackingToShopify } from "~/domain/freight/sync-tracking-to-shopify.server";
import { createFreightTestTracker } from "./helpers";

describe("syncFreightTrackingToShopify (integration)", () => {
  const tracker = createFreightTestTracker();
  afterAll(tracker.cleanup);

  it("rejects when the shipment doesn't exist", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const result = await syncFreightTrackingToShopify({
      shopId: order.shopId,
      freightShipmentId: randomUUID(),
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("rejects when the shipment has no tracking number yet (still PREPARING)", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const shipment = await db.freightShipment.create({
      data: {
        shopId: order.shopId,
        orderId: order.id,
        status: "PREPARING",
        idempotencyKey: randomUUID(),
        carrierCode: "AusPost",
        carrierServiceCode: "Standard",
        createdByStaffId: staffUser.id,
      },
    });

    const result = await syncFreightTrackingToShopify({
      shopId: order.shopId,
      freightShipmentId: shipment.id,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("returns already_synced without calling Shopify again once shopifyFulfillmentId is set", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const shipment = await db.freightShipment.create({
      data: {
        shopId: order.shopId,
        orderId: order.id,
        status: "CREATED",
        idempotencyKey: randomUUID(),
        carrierCode: "AusPost",
        carrierServiceCode: "Standard",
        trackingNumber: "TRACK123",
        shopifyFulfillmentId: "gid://shopify/Fulfillment/123",
        createdByStaffId: staffUser.id,
      },
    });

    const result = await syncFreightTrackingToShopify({
      shopId: order.shopId,
      freightShipmentId: shipment.id,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("already_synced");
  });

  // The seeded dev shop's Shopify domain/admin token are placeholders (see
  // prisma/seed.ts), so this genuinely hits the network and genuinely fails —
  // same honest-failure pattern as Klaviyo (technical-debt item 19). This
  // proves the failure is recorded via IntegrationFailure/STARSHIPIT and the
  // shipment's own CREATED status and tracking number are left untouched.
  it("against the real (placeholder-credentialed) Shopify API, fails closed and records an IntegrationFailure without touching the shipment", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const shipment = await db.freightShipment.create({
      data: {
        shopId: order.shopId,
        orderId: order.id,
        status: "CREATED",
        idempotencyKey: randomUUID(),
        carrierCode: "AusPost",
        carrierServiceCode: "Standard",
        carrierName: "Australia Post",
        trackingNumber: "TRACK123",
        createdByStaffId: staffUser.id,
      },
    });

    const result = await syncFreightTrackingToShopify({
      shopId: order.shopId,
      freightShipmentId: shipment.id,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");

    const reloadedShipment = await db.freightShipment.findUniqueOrThrow({
      where: { id: shipment.id },
    });
    expect(reloadedShipment.status).toBe("CREATED");
    expect(reloadedShipment.trackingNumber).toBe("TRACK123");
    expect(reloadedShipment.shopifyFulfillmentId).toBeNull();

    const reloadedOrder = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.workflowStatus).not.toBe("FULFILLED");

    const failure = await db.integrationFailure.findFirst({
      where: {
        shopId: order.shopId,
        integration: "STARSHIPIT",
        action: "freight_tracking_sync",
        relatedOrderId: order.id,
      },
    });
    expect(failure).not.toBeNull();
  }, 20000);
});
