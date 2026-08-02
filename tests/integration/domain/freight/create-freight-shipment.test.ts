import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createFreightShipment } from "~/domain/freight/create-freight-shipment.server";
import { createFreightTestTracker } from "./helpers";

describe("createFreightShipment (integration)", () => {
  const tracker = createFreightTestTracker();
  afterAll(tracker.cleanup);

  it("rejects when production isn't complete — never contacts Starshipit at all", async () => {
    const order = await tracker.createOrder({ productionSummary: "IN_PROGRESS" });
    const staffUser = await tracker.createStaffUser();

    const result = await createFreightShipment({
      shopId: order.shopId,
      orderId: order.id,
      carrierCode: "AusPost",
      carrierServiceCode: "Standard",
      packagingPresetName: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });

    expect(result.outcome).toBe("rejected");
    expect(await db.freightShipment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("rejects when the order has no shipping address on file", async () => {
    const order = await tracker.createOrder({ shippingAddress: null });
    const staffUser = await tracker.createStaffUser();

    const result = await createFreightShipment({
      shopId: order.shopId,
      orderId: order.id,
      carrierCode: "AusPost",
      carrierServiceCode: "Standard",
      packagingPresetName: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).toMatch(/shipping address/i);
    }
    expect(await db.freightShipment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("rejects when an active shipment already exists for the order", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    await db.freightShipment.create({
      data: {
        shopId: order.shopId,
        orderId: order.id,
        status: "CREATED",
        idempotencyKey: randomUUID(),
        carrierCode: "AusPost",
        carrierServiceCode: "Standard",
        createdByStaffId: staffUser.id,
      },
    });

    const result = await createFreightShipment({
      shopId: order.shopId,
      orderId: order.id,
      carrierCode: "AusPost",
      carrierServiceCode: "Standard",
      packagingPresetName: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).toMatch(/already/i);
    }
  });

  it("rejects when carrier or service level is blank", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const result = await createFreightShipment({
      shopId: order.shopId,
      orderId: order.id,
      carrierCode: "   ",
      carrierServiceCode: "Standard",
      packagingPresetName: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });

    expect(result.outcome).toBe("rejected");
  });

  // The test environment's Starshipit credentials are deliberately fake
  // (vitest.config.ts's `test.env` block, same as Klaviyo — see
  // technical-debt item 19) — this proves the honest-failure path really
  // works: the reserved row is marked FAILED with a real reason, never left
  // half-created or silently swallowed.
  it("against the real (fake-credentialed) Starshipit API, fails closed and marks the shipment FAILED", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    await tracker.createOrderLine(order.id);

    const result = await createFreightShipment({
      shopId: order.shopId,
      orderId: order.id,
      carrierCode: "AusPost",
      carrierServiceCode: "Standard",
      packagingPresetName: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });

    expect(result.outcome).toBe("rejected");
    const shipment = await db.freightShipment.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(shipment.status).toBe("FAILED");
    expect(shipment.cancelReason).toBeTruthy();
    // Never partially applied — no tracking number, no label, no Shopify link.
    expect(shipment.trackingNumber).toBeNull();
    expect(shipment.labelStorageKey).toBeNull();
    expect(shipment.shopifyFulfillmentId).toBeNull();
  }, 20000);

  it("a duplicate submission with the same idempotency key returns the existing row rather than contacting Starshipit again", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    await tracker.createOrderLine(order.id);
    const idempotencyKey = randomUUID();

    const first = await createFreightShipment({
      shopId: order.shopId,
      orderId: order.id,
      carrierCode: "AusPost",
      carrierServiceCode: "Standard",
      packagingPresetName: null,
      staffUserId: staffUser.id,
      idempotencyKey,
    });
    const second = await createFreightShipment({
      shopId: order.shopId,
      orderId: order.id,
      carrierCode: "AusPost",
      carrierServiceCode: "Standard",
      packagingPresetName: null,
      staffUserId: staffUser.id,
      idempotencyKey,
    });

    expect(second.outcome).toBe("duplicate");
    if (first.outcome !== "rejected" && second.outcome === "duplicate") {
      expect(second.freightShipmentId).toBe(
        (first as { freightShipmentId: string }).freightShipmentId,
      );
    }
    expect(await db.freightShipment.count({ where: { orderId: order.id } })).toBe(1);
  }, 20000);
});
