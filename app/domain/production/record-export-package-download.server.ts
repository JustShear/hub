import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface RecordExportPackageDownloadInput {
  shopId: string;
  exportBatchId: string;
  staffUserId: string;
}

export type RecordExportPackageDownloadResult =
  | { outcome: "recorded"; packageStorageKey: string; batchNumber: number }
  | { outcome: "rejected"; reason: string };

/**
 * Called by the download route on every successful package fetch —
 * `downloadCount`/`lastDownloadedAt` are informational only (never gate
 * anything), so an ordinary (non-transactional) update is enough; there's
 * no correctness property that depends on this being exactly-once.
 */
export async function recordExportPackageDownload(
  input: RecordExportPackageDownloadInput,
): Promise<RecordExportPackageDownloadResult> {
  const batch = await db.exportBatch.findFirst({
    where: { id: input.exportBatchId, shopId: input.shopId },
  });
  if (!batch) {
    return { outcome: "rejected", reason: "Export batch not found." };
  }
  if (!batch.packageStorageKey) {
    return { outcome: "rejected", reason: "This export batch has no package available yet." };
  }

  await db.exportBatch.update({
    where: { id: batch.id },
    data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() },
  });
  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      orderId: batch.orderId,
      entityType: "ExportBatch",
      entityId: batch.id,
      eventType: "export_package_downloaded",
      summary: `Export package for batch ${batch.batchNumber} downloaded`,
      metadata: { batchNumber: batch.batchNumber },
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  return {
    outcome: "recorded",
    packageStorageKey: batch.packageStorageKey,
    batchNumber: batch.batchNumber,
  };
}
