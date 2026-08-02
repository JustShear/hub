import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProductionArtwork } from "~/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "~/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "~/domain/production/mark-production-artwork-ready.server";
import { createExportBatch } from "~/domain/production/create-export-batch.server";
import { scanTaskQuantity } from "~/domain/production/scan-task-quantity.server";
import { createProductionTestTracker, PDF_BYTES } from "./helpers";

describe("scanTaskQuantity (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  async function seedTask() {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, 5);
    const approved = await tracker.createApprovedGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineId: line.id,
    });
    const artwork = await createProductionArtwork({
      shopId: order.shopId,
      proofGroupId: approved.proofGroupId,
      fileBuffer: PDF_BYTES,
      originalFilename: "scan-test-artwork.pdf",
      decorationMethod: null,
      placement: "Left chest",
      productionMetadata: null,
      staffUserId: staffUser.id,
      idempotencyKey: null,
    });
    if (artwork.outcome !== "created") throw new Error("setup failed: createProductionArtwork");
    const allocation = await setProductionArtworkOrderLines({
      shopId: order.shopId,
      productionArtworkId: artwork.productionArtworkId,
      allocations: [{ orderLineId: line.id, quantity: line.quantity }],
      staffUserId: staffUser.id,
    });
    if (allocation.outcome !== "set")
      throw new Error("setup failed: setProductionArtworkOrderLines");
    const ready = await markProductionArtworkReady({
      shopId: order.shopId,
      productionArtworkId: artwork.productionArtworkId,
      staffUserId: staffUser.id,
    });
    if (ready.outcome !== "ready") throw new Error("setup failed: markProductionArtworkReady");
    const exportResult = await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [approved.proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey: `scan-test-export-${approved.proofGroupId}`,
    });
    if (exportResult.outcome !== "exported") throw new Error("setup failed: createExportBatch");
    const task = await db.productionTask.findFirstOrThrow({
      where: { productionJob: { exportBatchId: exportResult.exportBatchId } },
    });
    return { order, staffUser, task };
  }

  it("always records the scan as informational and increments completed quantity by one", async () => {
    const { order, staffUser, task } = await seedTask();

    const result = await scanTaskQuantity({
      shopId: order.shopId,
      productionTaskId: task.id,
      scannedValue: "ANY-BARCODE-VALUE",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "recorded", completedQuantity: 1 });

    const scanEvent = await db.scanEvent.findFirstOrThrow({
      where: { relatedEntityType: "ProductionTask", relatedEntityId: task.id },
    });
    expect(scanEvent.result).toBe("UNKNOWN");
    expect(scanEvent.expectedValue).toBeNull();
  });

  it("rejects a scan against a task that doesn't exist", async () => {
    const { order, staffUser } = await seedTask();

    const result = await scanTaskQuantity({
      shopId: order.shopId,
      productionTaskId: "nonexistent-task-id",
      scannedValue: "ANY-VALUE",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });
});
