import { randomUUID } from "node:crypto";
import { db } from "~/lib/db.server";
import { recordScanEvent } from "~/domain/barcodes/record-scan-event.server";
import { recordProductionQuantity } from "~/domain/production/record-production-quantity.server";

export interface ScanTaskQuantityInput {
  shopId: string;
  productionTaskId: string;
  scannedValue: string;
  staffUserId: string;
}

export type ScanTaskQuantityResult =
  { outcome: "recorded"; completedQuantity: number } | { outcome: "rejected"; reason: string };

/**
 * Production scan-to-fill (Milestone 16) — informational only, never
 * blocking. Unlike a WarehousePickItem, a ProductionTask has no single SKU
 * to validate against (a proof group can span multiple order lines), so
 * every scan is recorded as UNKNOWN and always increments the produced
 * quantity by one — a faster input method, not a claim the barcode was
 * actually verified against anything.
 */
export async function scanTaskQuantity(
  input: ScanTaskQuantityInput,
): Promise<ScanTaskQuantityResult> {
  const task = await db.productionTask.findFirst({
    where: {
      id: input.productionTaskId,
      productionJob: { shopId: input.shopId },
    },
  });
  if (!task) {
    return { outcome: "rejected", reason: "Production task not found." };
  }

  await recordScanEvent({
    shopId: input.shopId,
    scannedValue: input.scannedValue,
    barcodeType: "SKU",
    expectedValue: null,
    relatedEntityType: "ProductionTask",
    relatedEntityId: task.id,
    staffUserId: input.staffUserId,
    station: null,
    result: "UNKNOWN",
    overrideReason: null,
  });

  const recorded = await recordProductionQuantity({
    shopId: input.shopId,
    productionTaskId: input.productionTaskId,
    newlyProducedQuantity: 1,
    newlyFailedQuantity: 0,
    reworkedQuantity: 0,
    overrideReason: null,
    idempotencyKey: randomUUID(),
    staffUserId: input.staffUserId,
  });
  if (recorded.outcome === "rejected") {
    return { outcome: "rejected", reason: recorded.reason };
  }

  return { outcome: "recorded", completedQuantity: recorded.completedQuantity };
}
