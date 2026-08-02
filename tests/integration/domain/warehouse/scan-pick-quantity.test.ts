import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { scanPickQuantity } from "~/domain/warehouse/scan-pick-quantity.server";
import { createWarehouseTestTracker } from "./helpers";

describe("scanPickQuantity (integration)", () => {
  const tracker = createWarehouseTestTracker();
  afterAll(tracker.cleanup);

  async function seedPickItem() {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, 3);
    await tracker.completeOrderProduction({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: line.id,
      quantity: 3,
      staffUserId: staffUser.id,
    });
    const item = await db.warehousePickItem.findFirstOrThrow({
      where: { orderLineId: line.id },
    });
    // Give the item a real SKU to scan against — the order line fixture
    // doesn't set one by default.
    const withSku = await db.warehousePickItem.update({
      where: { id: item.id },
      data: { sku: "SKU-TEST-123" },
    });
    return { order, staffUser, item: withSku };
  }

  it("records a MATCH scan and increments the picked quantity by one", async () => {
    const { order, staffUser, item } = await seedPickItem();

    const result = await scanPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      scannedValue: "SKU-TEST-123",
      overrideReason: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "recorded", pickedQuantity: 1, scanResult: "MATCH" });

    const scanEvent = await db.scanEvent.findFirstOrThrow({
      where: { relatedEntityType: "WarehousePickItem", relatedEntityId: item.id },
    });
    expect(scanEvent.result).toBe("MATCH");
  });

  it("rejects a mismatched scan without an override reason, without recording any quantity", async () => {
    const { order, staffUser, item } = await seedPickItem();

    const result = await scanPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      scannedValue: "WRONG-SKU",
      overrideReason: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "mismatch" });

    const updated = await db.warehousePickItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.pickedQuantity).toBe(0);

    const scanEvent = await db.scanEvent.findFirstOrThrow({
      where: { relatedEntityType: "WarehousePickItem", relatedEntityId: item.id },
    });
    expect(scanEvent.result).toBe("MISMATCH");
  });

  it("accepts a mismatched scan with an override reason, recording it as OVERRIDDEN", async () => {
    const { order, staffUser, item } = await seedPickItem();

    const result = await scanPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      scannedValue: "WRONG-SKU",
      overrideReason: "Label was smudged, confirmed visually against the packing slip",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({
      outcome: "recorded",
      pickedQuantity: 1,
      scanResult: "OVERRIDDEN",
    });

    const scanEvent = await db.scanEvent.findFirstOrThrow({
      where: { relatedEntityType: "WarehousePickItem", relatedEntityId: item.id },
    });
    expect(scanEvent.result).toBe("OVERRIDDEN");
    expect(scanEvent.overrideReason).toContain("smudged");
  });
});
