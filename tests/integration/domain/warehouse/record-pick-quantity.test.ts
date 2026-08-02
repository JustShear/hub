import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { recordPickQuantity } from "~/domain/warehouse/record-pick-quantity.server";
import { createWarehouseTestTracker } from "./helpers";

describe("recordPickQuantity (integration)", () => {
  const tracker = createWarehouseTestTracker();
  afterAll(tracker.cleanup);

  async function setUpPickJob(quantity: number) {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, quantity);
    const pickJob = await tracker.completeOrderProduction({
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

  it("records a partial pick and derives IN_PROGRESS, then recalculates the job to IN_PROGRESS", async () => {
    const { order, staffUser, pickJob, item } = await setUpPickJob(10);

    const result = await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 4,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    expect(result).toEqual({ outcome: "recorded", pickedQuantity: 4 });
    const reloadedItem = await db.warehousePickItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(reloadedItem.status).toBe("IN_PROGRESS");
    const reloadedJob = await db.warehousePickJob.findUniqueOrThrow({ where: { id: pickJob.id } });
    expect(reloadedJob.status).toBe("IN_PROGRESS");
    expect(reloadedJob.startedAt).not.toBeNull();
  });

  it("reaching the full required quantity derives PICKED", async () => {
    const { order, staffUser, item } = await setUpPickJob(6);

    const result = await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 6,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    expect(result).toEqual({ outcome: "recorded", pickedQuantity: 6 });
    const reloadedItem = await db.warehousePickItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(reloadedItem.status).toBe("PICKED");
  });

  it("rejects a quantity that would exceed the required quantity", async () => {
    const { order, staffUser, item } = await setUpPickJob(5);

    const result = await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 10,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
    const reloadedItem = await db.warehousePickItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(reloadedItem.pickedQuantity).toBe(0);
  });

  it("a duplicate idempotency key returns the duplicate outcome without double-counting", async () => {
    const { order, staffUser, item } = await setUpPickJob(10);
    const idempotencyKey = randomUUID();

    const first = await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 3,
      idempotencyKey,
      staffUserId: staffUser.id,
    });
    const second = await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 3,
      idempotencyKey,
      staffUserId: staffUser.id,
    });

    expect(first).toEqual({ outcome: "recorded", pickedQuantity: 3 });
    expect(second).toEqual({ outcome: "duplicate", pickedQuantity: 3 });
    const reloadedItem = await db.warehousePickItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(reloadedItem.pickedQuantity).toBe(3);
  });

  it("rejects recording a pick against an item blocked by an open blocking issue", async () => {
    const { order, staffUser, item } = await setUpPickJob(10);
    await db.warehouseIssue.create({
      data: {
        shopId: order.shopId,
        orderId: order.id,
        warehousePickJobId: item.warehousePickJobId,
        warehousePickItemId: item.id,
        issueType: "WRONG_LOCATION",
        severity: "MEDIUM",
        description: "Wrong bin location — needs relocating before picking.",
        isBlocking: true,
        createdByStaffId: staffUser.id,
      },
    });

    const result = await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 5,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).toMatch(/blocked/i);
    }
  });
});
