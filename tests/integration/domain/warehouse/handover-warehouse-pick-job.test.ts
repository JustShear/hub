import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { recordPickQuantity } from "~/domain/warehouse/record-pick-quantity.server";
import { markPickItemShort } from "~/domain/warehouse/mark-pick-item-short.server";
import { handoverWarehousePickJob } from "~/domain/warehouse/handover-warehouse-pick-job.server";
import { createWarehouseTestTracker } from "./helpers";

describe("handoverWarehousePickJob (integration)", () => {
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

  it("rejects handover while any line is still pending or in progress", async () => {
    const { order, staffUser, pickJob } = await setUpPickJob(10);

    const result = await handoverWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("succeeds once every line is picked, setting READY_TO_PACK and warehousePickSummary=HANDED_OVER", async () => {
    const { order, staffUser, pickJob, item } = await setUpPickJob(10);
    await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 10,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });

    const result = await handoverWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      staffUserId: staffUser.id,
    });

    expect(result).toEqual({ outcome: "handed_over" });
    const reloadedJob = await db.warehousePickJob.findUniqueOrThrow({ where: { id: pickJob.id } });
    expect(reloadedJob.status).toBe("HANDED_OVER");
    expect(reloadedJob.handedOverAt).not.toBeNull();
    const reloadedOrder = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.warehousePickSummary).toBe("HANDED_OVER");
    expect(reloadedOrder.workflowStatus).toBe("READY_TO_PACK");
  });

  it("succeeds with a mix of PICKED and SHORT lines — a short line never blocks handover", async () => {
    const { order, staffUser, pickJob, item } = await setUpPickJob(10);
    await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 6,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });
    await markPickItemShort({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      reason: "4 units out of stock.",
      staffUserId: staffUser.id,
    });

    const result = await handoverWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      staffUserId: staffUser.id,
    });

    expect(result).toEqual({ outcome: "handed_over" });
  });

  it("is idempotent — handing over an already-handed-over job returns already_there", async () => {
    const { order, staffUser, pickJob, item } = await setUpPickJob(5);
    await recordPickQuantity({
      shopId: order.shopId,
      warehousePickItemId: item.id,
      newlyPickedQuantity: 5,
      idempotencyKey: randomUUID(),
      staffUserId: staffUser.id,
    });
    await handoverWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      staffUserId: staffUser.id,
    });

    const second = await handoverWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      staffUserId: staffUser.id,
    });

    expect(second).toEqual({ outcome: "already_there" });
  });
});
