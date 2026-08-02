import type { DecorationMethod, ExportBatchStatus, NoProofReason } from "@prisma/client";
import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

export interface OrderDetailExportBatchItem {
  proofGroupId: string;
  proofGroupName: string;
  productionArtworkId: string;
  productionArtworkRevisionNumber: number;
  sourceProofVersionNumber: number | null;
  sourceNoProofReasonSnapshot: NoProofReason | null;
  decorationMethodSnapshot: DecorationMethod;
  placementSnapshot: string | null;
}

export interface OrderDetailExportBatch {
  id: string;
  batchNumber: number;
  status: ExportBatchStatus;
  destination: string | null;
  createdByStaffId: string;
  createdByStaffName: string;
  createdAt: string;
  exportedAt: string | null;
  packageChecksum: string | null;
  hasPackage: boolean;
  downloadCount: number;
  lastDownloadedAt: string | null;
  previousBatchId: string | null;
  reexportReason: string | null;
  cancelReason: string | null;
  items: OrderDetailExportBatchItem[];
}

export async function loadExportBatchesForOrder(params: {
  shopId: string;
  orderId: string;
}): Promise<OrderDetailExportBatch[]> {
  const batches = await db.exportBatch.findMany({
    where: { orderId: params.orderId, shopId: params.shopId },
    orderBy: { batchNumber: "desc" },
    include: {
      items: {
        include: {
          proofGroup: { select: { name: true } },
          productionArtwork: { select: { revisionNumber: true } },
        },
      },
    },
  });

  if (batches.length === 0) return [];

  const staffNames = await resolveStaffNames(batches.map((b) => b.createdByStaffId));

  return batches.map((batch): OrderDetailExportBatch => {
    return {
      id: batch.id,
      batchNumber: batch.batchNumber,
      status: batch.status,
      destination: batch.destination,
      createdByStaffId: batch.createdByStaffId,
      createdByStaffName: staffNames.get(batch.createdByStaffId) ?? "Unknown staff member",
      createdAt: batch.createdAt.toISOString(),
      exportedAt: batch.exportedAt?.toISOString() ?? null,
      packageChecksum: batch.packageChecksum,
      hasPackage: batch.packageStorageKey !== null,
      downloadCount: batch.downloadCount,
      lastDownloadedAt: batch.lastDownloadedAt?.toISOString() ?? null,
      previousBatchId: batch.previousBatchId,
      reexportReason: batch.reexportReason,
      cancelReason: batch.cancelReason,
      items: batch.items.map((item) => ({
        proofGroupId: item.proofGroupId,
        proofGroupName: item.proofGroup.name,
        productionArtworkId: item.productionArtworkId,
        productionArtworkRevisionNumber: item.productionArtwork.revisionNumber,
        sourceProofVersionNumber: item.sourceProofVersionNumber,
        sourceNoProofReasonSnapshot: item.sourceNoProofReasonSnapshot,
        decorationMethodSnapshot: item.decorationMethodSnapshot,
        placementSnapshot: item.placementSnapshot,
      })),
    };
  });
}
