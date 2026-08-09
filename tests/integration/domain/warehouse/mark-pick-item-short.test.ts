import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { recordPickQuantity } from "~/domain/warehouse/record-pick-quantity.server";
import { markPickItemShort } from "~/domain/warehouse/mark-pick-item-short.server";
import { createWarehouseTestTracker } from "./helpers";

describe("markPickItemShort (integration)", () => {
  const tracker = createWarehouseTestTracker();
  afterAll(tracker.cleanup);

  async function setUpPickJob(quantity: number) {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, quantity);
    const pickJob = await tracker.createPickJobForOrder({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: line.id,
      quantity,
      staffUserId: staffUser.id,
    });
    const item = await db.warehousePickItem.findFirstOrThrow({
      where: { warehousePickJobId: pickJob.id },
    });
    return { order, staffUser, pickJob, item };
  }

  it("requires a non-blank reason", async () => {
    const { order, staffUser, item } = await setUpPickJob(10);

    const result = await markPickItemShort({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      reason: "   ",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("marks the full remainder short and auto-creates a non-blocking STOCK_SHORTAGE issue", async () => {
    const { order, staffUser, item } = await setUpPickJob(10);

    const result = await markPickItemShort({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      reason: "Supplier is out of stock on this SKU.",
      staffUserId: staffUser.id,
    });

    expect(result).toEqual({ outcome: "marked", shortQuantity: 10 });
    const reloadedItem = await db.warehousePickItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(reloadedItem.status).toBe("SHORT");
    expect(reloadedItem.shortReason).toBe("Supplier is out of stock on this SKU.");

    const issue = await db.warehouseIssue.findFirstOrThrow({
      where: { warehousePickItemId: item.id },
    });
    expect(issue.issueType).toBe("STOCK_SHORTAGE");
    expect(issue.isBlocking).toBe(false);
  });

  it("marks only the unaccounted-for remainder short after a partial pick", async () => {
    const { order, staffUser, item } = await setUpPickJob(10);
    await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 7,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    const result = await markPickItemShort({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      reason: "Only 7 available on the shelf.",
      staffUserId: staffUser.id,
    });

    expect(result).toEqual({ outcome: "marked", shortQuantity: 3 });
    const reloadedItem = await db.warehousePickItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(reloadedItem.pickedQuantity).toBe(7);
    expect(reloadedItem.shortQuantity).toBe(3);
    expect(reloadedItem.status).toBe("SHORT");
  });

  it("rejects marking short when the item is already fully accounted for", async () => {
    const { order, staffUser, item } = await setUpPickJob(5);
    await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 5,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    const result = await markPickItemShort({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      reason: "Trying to mark an already-complete line short.",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });
});
