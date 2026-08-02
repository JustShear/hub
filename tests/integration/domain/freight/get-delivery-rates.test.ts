import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDeliveryRates } from "~/domain/freight/get-delivery-rates.server";
import { createFreightTestTracker } from "./helpers";

describe("getDeliveryRates (integration)", () => {
  const tracker = createFreightTestTracker();
  afterAll(tracker.cleanup);

  it("rejects when weight is zero or negative", async () => {
    const order = await tracker.createOrder();

    const result = await getDeliveryRates({
      shopId: order.shopId,
      orderId: order.id,
      weightKg: 0,
      heightM: null,
      widthM: null,
      lengthM: null,
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).toMatch(/weight/i);
    }
  });

  it("rejects when the order doesn't exist", async () => {
    const order = await tracker.createOrder();

    const result = await getDeliveryRates({
      shopId: order.shopId,
      orderId: randomUUID(),
      weightKg: 1.5,
      heightM: null,
      widthM: null,
      lengthM: null,
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).toMatch(/order/i);
    }
  });

  it("rejects when the order has no shipping address on file", async () => {
    const order = await tracker.createOrder({ shippingAddress: null });

    const result = await getDeliveryRates({
      shopId: order.shopId,
      orderId: order.id,
      weightKg: 1.5,
      heightM: null,
      widthM: null,
      lengthM: null,
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).toMatch(/shipping address/i);
    }
  });

  // The test environment's Starshipit credentials are deliberately fake (see
  // create-freight-shipment.test.ts's equivalent case, and technical-debt
  // item 19) — this proves the honest-failure path really works: a real
  // network/auth failure against Starshipit surfaces as a clear rejection
  // rather than silently returning an empty rate list.
  it("against the real (fake-credentialed) Starshipit API, fails closed with a reason", async () => {
    const order = await tracker.createOrder();

    const result = await getDeliveryRates({
      shopId: order.shopId,
      orderId: order.id,
      weightKg: 1.5,
      heightM: 0.1,
      widthM: 0.2,
      lengthM: 0.3,
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).toBeTruthy();
    }
  }, 20000);
});
