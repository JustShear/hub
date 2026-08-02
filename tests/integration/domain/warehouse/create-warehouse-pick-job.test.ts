import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createWarehousePickJobForOrder } from "~/domain/warehouse/create-warehouse-pick-job.server";
import { createWarehouseTestTracker } from "./helpers";

describe("warehouse pick job auto-creation (integration)", () => {
  const tracker = createWarehouseTestTracker();
  afterAll(tracker.cleanup);

  it("creates a WarehousePickJob with one item per order line the moment production genuinely completes", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, 12);

    const pickJob = await tracker.completeOrderProduction({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: line.id,
      quantity: 12,
      staffUserId: staffUser.id,
    });

    expect(pickJob.status).toBe("QUEUED");
    const items = await db.warehousePickItem.findMany({
      where: { warehousePickJobId: pickJob.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ requiredQuantity: 12, pickedQuantity: 0, status: "PENDING" });

    const reloadedOrder = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(reloadedOrder.productionSummary).toBe("COMPLETE");
    expect(reloadedOrder.warehousePickSummary).toBe("NOT_STARTED");
  });

  it("is a no-op when a pick job already exists for the order — the direct existence-check guard", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, 5);

    const firstJob = await tracker.completeOrderProduction({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: line.id,
      quantity: 5,
      staffUserId: staffUser.id,
    });

    // Calling the creation function again directly (bypassing the summary
    // transition it's normally gated behind) must still be a genuine no-op.
    await db.$transaction((tx) =>
      createWarehousePickJobForOrder(tx, {
        shopId: order.shopId,
        orderId: order.id,
        actorStaffId: staffUser.id,
      }),
    );

    const jobs = await db.warehousePickJob.findMany({ where: { orderId: order.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(firstJob.id);
  });
});
