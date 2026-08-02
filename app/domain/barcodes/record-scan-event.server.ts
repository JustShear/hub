import type { BarcodeType, ScanResult } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface RecordScanEventInput {
  shopId: string;
  scannedValue: string;
  barcodeType: BarcodeType;
  expectedValue: string | null;
  relatedEntityType: string;
  relatedEntityId: string;
  staffUserId: string;
  station: string | null;
  result: ScanResult;
  overrideReason: string | null;
}

/**
 * Pure audit log — records that a scan happened and what its result was.
 * Never itself changes a quantity or any other domain state; the caller
 * composes this with whatever action the scan should trigger (see
 * scanPickQuantity/scanTaskQuantity in warehouse.actions.tsx/
 * production.actions.tsx).
 */
export async function recordScanEvent(input: RecordScanEventInput): Promise<{ id: string }> {
  const event = await db.scanEvent.create({
    data: {
      shopId: input.shopId,
      scannedValue: input.scannedValue,
      barcodeType: input.barcodeType,
      expectedValue: input.expectedValue,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      staffUserId: input.staffUserId,
      station: input.station,
      result: input.result,
      overrideReason: input.overrideReason,
    },
  });
  return { id: event.id };
}
