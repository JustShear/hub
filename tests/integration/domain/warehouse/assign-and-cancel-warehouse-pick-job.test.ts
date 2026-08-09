import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { assignWarehousePickJob } from "~/domain/warehouse/assign-warehouse-pick-job.server";
import { cancelWarehousePickJob } from "~/domain/warehouse/cancel-warehouse-pick-job.server";
import { createWarehouseTestTracker } from "./helpers";

describe("assignWarehousePickJob (integration)", () => {
  const tracker = createWarehouseTestTracker();
  afterAll(tracker.cleanup);

  async function setUpPickJob() {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, 5);
    const pickJob = await tracker.createPickJobForOrder({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: line.id,
      quantity: 5,
      staffUserId: staffUser.id,
    });
    return { order, staffUser, pickJob };
  }

  it("assigns a staff member using the version CAS", async () => {
    const { order, staffUser, pickJob } = await setUpPickJob();
    const targetStaff = await tracker.createStaffUser();

    const result = await assignWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      targetStaffUserId: targetStaff.id,
      expectedVersion: pickJob.version,
      staffUserId: staffUser.id,
    });

    expect(result).toEqual({ outcome: "assigned" });
    const reloaded = await db.warehousePickJob.findUniqueOrThrow({ where: { id: pickJob.id } });
    expect(reloaded.assignedStaffId).toBe(targetStaff.id);
    expect(reloaded.version).toBe(pickJob.version + 1);
  });

  it("rejects a stale version with a conflict", async () => {
    const { order, staffUser, pickJob } = await setUpPickJob();
    const targetStaff = await tracker.createStaffUser();

    const result = await assignWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      targetStaffUserId: targetStaff.id,
      expectedVersion: pickJob.version + 5,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("conflict");
  });

  it("clearing the assignment (null) is a real, distinct operation from any staff id", async () => {
    const { order, staffUser, pickJob } = await setUpPickJob();
    const targetStaff = await tracker.createStaffUser();
    await assignWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      targetStaffUserId: targetStaff.id,
      expectedVersion: pickJob.version,
      staffUserId: staffUser.id,
    });
    const afterFirst = await db.warehousePickJob.findUniqueOrThrow({ where: { id: pickJob.id } });

    const result = await assignWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      targetStaffUserId: null,
      expectedVersion: afterFirst.version,
      staffUserId: staffUser.id,
    });

    expect(result).toEqual({ outcome: "assigned" });
    const reloaded = await db.warehousePickJob.findUniqueOrThrow({ where: { id: pickJob.id } });
    expect(reloaded.assignedStaffId).toBeNull();
  });
});

describe("cancelWarehousePickJob (integration)", () => {
  const tracker = createWarehouseTestTracker();
  afterAll(tracker.cleanup);

  async function setUpPickJob() {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, 5);
    const pickJob = await tracker.createPickJobForOrder({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: line.id,
      quantity: 5,
      staffUserId: staffUser.id,
    });
    return { order, staffUser, pickJob };
  }

  it("requires a non-blank reason", async () => {
    const { order, staffUser, pickJob } = await setUpPickJob();

    const result = await cancelWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      reason: "  ",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("cancels a queued job given a reason", async () => {
    const { order, staffUser, pickJob } = await setUpPickJob();

    const result = await cancelWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      reason: "Order was cancelled by the customer.",
      staffUserId: staffUser.id,
    });

    expect(result).toEqual({ outcome: "cancelled" });
    const reloaded = await db.warehousePickJob.findUniqueOrThrow({ where: { id: pickJob.id } });
    expect(reloaded.status).toBe("CANCELLED");
    expect(reloaded.cancelReason).toBe("Order was cancelled by the customer.");
  });

  it("is idempotent — cancelling an already-cancelled job returns already_there", async () => {
    const { order, staffUser, pickJob } = await setUpPickJob();
    await cancelWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      reason: "First cancellation.",
      staffUserId: staffUser.id,
    });

    const second = await cancelWarehousePickJob({
      shopId: order.shopId,
      warehousePickJobId: pickJob.id,
      reason: "Second attempt.",
      staffUserId: staffUser.id,
    });

    expect(second).toEqual({ outcome: "already_there" });
  });
});
