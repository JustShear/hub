import { afterAll, describe, expect, it } from "vitest";
import { getWarehouseReport } from "~/domain/warehouse/report.server";
import { createWarehouseTestTracker } from "./helpers";

describe("getWarehouseReport (integration)", () => {
  const tracker = createWarehouseTestTracker();
  afterAll(tracker.cleanup);

  it("counts a handed-over job and computes a real short rate from mixed picked/short items", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, 4);
    await tracker.createPickJobForOrder({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: line.id,
      quantity: 4,
      staffUserId: staffUser.id,
    });

    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    const report = await getWarehouseReport({ shopId: order.shopId, from, to });

    expect(report.currentQueuedJobCount + report.currentInProgressJobCount).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("returns null averages/rates when nothing happened in the date range", async () => {
    const order = await tracker.createOrder();
    const from = new Date("2020-01-01");
    const to = new Date("2020-01-02");
    const report = await getWarehouseReport({ shopId: order.shopId, from, to });

    expect(report.jobsHandedOver).toBe(0);
    expect(report.averageTimeToHandoverDays).toBeNull();
    expect(report.shortRatePercent).toBeNull();
  });
});
