import { db } from "~/lib/db.server";
import { createProductionArtwork } from "~/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "~/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "~/domain/production/mark-production-artwork-ready.server";
import { createExportBatch } from "~/domain/production/create-export-batch.server";
import { startProductionTask } from "~/domain/production/task-lifecycle.server";
import { recordProductionQuantity } from "~/domain/production/record-production-quantity.server";
import { performQualityCheck } from "~/domain/production/perform-quality-check.server";
import { completeProductionTask } from "~/domain/production/complete-production-task.server";
import {
  createProductionTestTracker,
  PDF_BYTES,
} from "~/../tests/integration/domain/production/helpers";

/**
 * Extends the Milestone 10/11 production test tracker with a helper that
 * drives an order's production all the way to genuine completion — the
 * only way a WarehousePickJob gets auto-created (see
 * recalculateOrderProductionSummary). Cleanup is inherited unchanged: the
 * production tracker's own cleanup() already tears down WarehousePickJob/
 * Item/Issue/Note rows before deleting the order (see
 * tests/integration/domain/production/helpers.ts).
 */
export function createWarehouseTestTracker() {
  const tracker = createProductionTestTracker();

  async function completeOrderProduction(params: {
    shopId: string;
    orderId: string;
    orderLineId: string;
    quantity: number;
    staffUserId: string;
  }) {
    const group = await tracker.createNoProofRequiredGroup({
      orderId: params.orderId,
      shopId: params.shopId,
      staffUserId: params.staffUserId,
      orderLineId: params.orderLineId,
      name: `Warehouse test group ${params.orderLineId}`,
    });

    const artwork = await createProductionArtwork({
      shopId: params.shopId,
      proofGroupId: group,
      fileBuffer: PDF_BYTES,
      originalFilename: "warehouse-test-production.pdf",
      decorationMethod: null,
      placement: "Front chest",
      productionMetadata: null,
      staffUserId: params.staffUserId,
      idempotencyKey: null,
    });
    if (artwork.outcome !== "created") {
      throw new Error(
        `completeOrderProduction: failed to create artwork — ${JSON.stringify(artwork)}`,
      );
    }

    const allocation = await setProductionArtworkOrderLines({
      shopId: params.shopId,
      productionArtworkId: artwork.productionArtworkId,
      allocations: [{ orderLineId: params.orderLineId, quantity: params.quantity }],
      staffUserId: params.staffUserId,
    });
    if (allocation.outcome !== "set") {
      throw new Error(
        `completeOrderProduction: failed to allocate lines — ${JSON.stringify(allocation)}`,
      );
    }

    const ready = await markProductionArtworkReady({
      shopId: params.shopId,
      productionArtworkId: artwork.productionArtworkId,
      staffUserId: params.staffUserId,
    });
    if (ready.outcome !== "ready") {
      throw new Error(`completeOrderProduction: failed to mark ready — ${JSON.stringify(ready)}`);
    }

    const exportResult = await createExportBatch({
      shopId: params.shopId,
      orderId: params.orderId,
      proofGroupIds: [group],
      destination: "Warehouse test destination",
      staffUserId: params.staffUserId,
      idempotencyKey: `warehouse-test-export-${group}`,
    });
    if (exportResult.outcome !== "exported") {
      throw new Error(
        `completeOrderProduction: failed to export — ${JSON.stringify(exportResult)}`,
      );
    }

    const task = await db.productionTask.findFirstOrThrow({
      where: { productionJob: { exportBatchId: exportResult.exportBatchId } },
    });
    await startProductionTask({
      shopId: params.shopId,
      productionTaskId: task.id,
      staffUserId: params.staffUserId,
    });
    await recordProductionQuantity({
      shopId: params.shopId,
      productionTaskId: task.id,
      newlyProducedQuantity: task.requiredQuantity,
      newlyFailedQuantity: 0,
      reworkedQuantity: 0,
      overrideReason: null,
      idempotencyKey: `warehouse-test-qty-${task.id}`,
      staffUserId: params.staffUserId,
    });
    await performQualityCheck({
      shopId: params.shopId,
      productionTaskId: task.id,
      checkedQuantity: task.requiredQuantity,
      approvedQuantity: task.requiredQuantity,
      failedQuantity: 0,
      checklistResult: { correct_artwork: true },
      notes: null,
      failureReason: null,
      staffUserId: params.staffUserId,
    });
    const completeResult = await completeProductionTask({
      shopId: params.shopId,
      productionTaskId: task.id,
      staffUserId: params.staffUserId,
    });
    if (completeResult.outcome === "rejected") {
      throw new Error(
        `completeOrderProduction: failed to complete — ${JSON.stringify(completeResult)}`,
      );
    }

    return db.warehousePickJob.findUniqueOrThrow({ where: { orderId: params.orderId } });
  }

  return { ...tracker, completeOrderProduction };
}
