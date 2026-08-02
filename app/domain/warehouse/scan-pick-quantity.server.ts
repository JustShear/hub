import { randomUUID } from "node:crypto";
import { db } from "~/lib/db.server";
import { validateScan } from "~/domain/barcodes/validate-scan";
import { recordScanEvent } from "~/domain/barcodes/record-scan-event.server";
import { recordPickQuantity } from "~/domain/warehouse/record-pick-quantity.server";

export interface ScanPickQuantityInput {
  shopId: string;
  warehousePickItemId: string;
  scannedValue: string;
  /** Required only when the scan doesn't match the item's own SKU — a deliberate staff override, never silent. */
  overrideReason: string | null;
  staffUserId: string;
}

export type ScanPickQuantityResult =
  | { outcome: "recorded"; pickedQuantity: number; scanResult: "MATCH" | "OVERRIDDEN" | "UNKNOWN" }
  | { outcome: "mismatch"; reason: string }
  | { outcome: "rejected"; reason: string };

/**
 * Warehouse scan-to-fill (Milestone 16) — a scanned barcode fills the
 * existing quantity-entry field instead of a manual button press.
 * WarehousePickItem.sku is a real, single value per line (unlike a
 * Production task, which can span multiple order lines), so a mismatch is
 * enforced, not just informational: it requires a staff override reason
 * before proceeding, mirroring this codebase's consistent reasoned-override
 * pattern rather than silently accepting or silently blocking.
 */
export async function scanPickQuantity(
  input: ScanPickQuantityInput,
): Promise<ScanPickQuantityResult> {
  const item = await db.warehousePickItem.findFirst({
    where: {
      id: input.warehousePickItemId,
      warehousePickJob: { shopId: input.shopId },
    },
  });
  if (!item) {
    return { outcome: "rejected", reason: "Pick item not found." };
  }

  const scanResult = validateScan(input.scannedValue, item.sku);

  if (scanResult === "MISMATCH" && !input.overrideReason?.trim()) {
    await recordScanEvent({
      shopId: input.shopId,
      scannedValue: input.scannedValue,
      barcodeType: "SKU",
      expectedValue: item.sku,
      relatedEntityType: "WarehousePickItem",
      relatedEntityId: item.id,
      staffUserId: input.staffUserId,
      station: null,
      result: "MISMATCH",
      overrideReason: null,
    });
    return {
      outcome: "mismatch",
      reason: `Scanned value doesn't match this line's SKU (${item.sku ?? "none on file"}) — an override reason is required to proceed anyway.`,
    };
  }

  const finalResult = scanResult === "MISMATCH" ? "OVERRIDDEN" : scanResult;
  await recordScanEvent({
    shopId: input.shopId,
    scannedValue: input.scannedValue,
    barcodeType: "SKU",
    expectedValue: item.sku,
    relatedEntityType: "WarehousePickItem",
    relatedEntityId: item.id,
    staffUserId: input.staffUserId,
    station: null,
    result: finalResult,
    overrideReason: scanResult === "MISMATCH" ? (input.overrideReason ?? null) : null,
  });

  const recorded = await recordPickQuantity({
    shopId: input.shopId,
    warehousePickItemId: input.warehousePickItemId,
    newlyPickedQuantity: 1,
    idempotencyKey: randomUUID(),
    staffUserId: input.staffUserId,
  });
  if (recorded.outcome === "rejected") {
    return { outcome: "rejected", reason: recorded.reason };
  }

  return {
    outcome: "recorded",
    pickedQuantity: recorded.pickedQuantity,
    scanResult: finalResult,
  };
}
