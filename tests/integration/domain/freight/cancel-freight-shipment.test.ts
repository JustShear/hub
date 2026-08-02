import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { cancelFreightShipment } from "~/domain/freight/cancel-freight-shipment.server";
import { createFreightTestTracker } from "./helpers";

async function createShipment(
  shopId: string,
  orderId: string,
  staffUserId: string,
  status: "PREPARING" | "CREATED" | "FAILED" | "CANCELLED" = "CREATED",
) {
  return db.freightShipment.create({
    data: {
      shopId,
      orderId,
      status,
      idempotencyKey: randomUUID(),
      carrierCode: "AusPost",
      carrierServiceCode: "Standard",
      createdByStaffId: staffUserId,
    },
  });
}

describe("cancelFreightShipment (integration)", () => {
  const tracker = createFreightTestTracker();
  afterAll(tracker.cleanup);

  it("requires a non-blank reason", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const shipment = await createShipment(order.shopId, order.id, staffUser.id);

    const result = await cancelFreightShipment({
      shopId: order.shopId,
      freightShipmentId: shipment.id,
      reason: "   ",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
    const reloaded = await db.freightShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(reloaded.status).toBe("CREATED");
  });

  it("rejects when the shipment doesn't exist", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const result = await cancelFreightShipment({
      shopId: order.shopId,
      freightShipmentId: randomUUID(),
      reason: "Customer requested cancellation",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it.each(["PREPARING", "CREATED", "FAILED"] as const)(
    "cancels a %s shipment given a reason",
    async (status) => {
      const order = await tracker.createOrder();
      const staffUser = await tracker.createStaffUser();
      const shipment = await createShipment(order.shopId, order.id, staffUser.id, status);

      const result = await cancelFreightShipment({
        shopId: order.shopId,
        freightShipmentId: shipment.id,
        reason: "Wrong address on file",
        staffUserId: staffUser.id,
      });

      expect(result.outcome).toBe("cancelled");
      const reloaded = await db.freightShipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(reloaded.status).toBe("CANCELLED");
      expect(reloaded.cancelReason).toBe("Wrong address on file");
      expect(reloaded.cancelledByStaffId).toBe(staffUser.id);
      expect(reloaded.cancelledAt).not.toBeNull();
    },
  );

  it("is idempotent — cancelling an already-cancelled shipment returns already_there without overwriting the original reason", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const shipment = await createShipment(order.shopId, order.id, staffUser.id, "CREATED");
    await cancelFreightShipment({
      shopId: order.shopId,
      freightShipmentId: shipment.id,
      reason: "Original reason",
      staffUserId: staffUser.id,
    });

    const second = await cancelFreightShipment({
      shopId: order.shopId,
      freightShipmentId: shipment.id,
      reason: "A different reason",
      staffUserId: staffUser.id,
    });

    expect(second.outcome).toBe("already_there");
    const reloaded = await db.freightShipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(reloaded.cancelReason).toBe("Original reason");
  });

  it("doesn't affect a sibling shipment on the same order", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const shipmentA = await createShipment(order.shopId, order.id, staffUser.id, "FAILED");
    const shipmentB = await createShipment(order.shopId, order.id, staffUser.id, "CREATED");

    await cancelFreightShipment({
      shopId: order.shopId,
      freightShipmentId: shipmentA.id,
      reason: "Duplicate attempt",
      staffUserId: staffUser.id,
    });

    const reloadedB = await db.freightShipment.findUniqueOrThrow({ where: { id: shipmentB.id } });
    expect(reloadedB.status).toBe("CREATED");
  });
});
