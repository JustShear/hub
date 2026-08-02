import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface RecordFreightLabelDownloadInput {
  shopId: string;
  freightShipmentId: string;
  staffUserId: string;
}

export type RecordFreightLabelDownloadResult =
  | { outcome: "recorded"; labelStorageKey: string; carrierName: string | null }
  | { outcome: "rejected"; reason: string };

/**
 * Same convention as record-export-package-download.server.ts —
 * downloadCount/lastDownloadedAt are informational only, so a plain
 * (non-transactional) update is enough.
 */
export async function recordFreightLabelDownload(
  input: RecordFreightLabelDownloadInput,
): Promise<RecordFreightLabelDownloadResult> {
  const shipment = await db.freightShipment.findFirst({
    where: { id: input.freightShipmentId, shopId: input.shopId },
  });
  if (!shipment) {
    return { outcome: "rejected", reason: "Freight shipment not found." };
  }
  if (!shipment.labelStorageKey) {
    return { outcome: "rejected", reason: "This freight shipment has no label available yet." };
  }

  await db.freightShipment.update({
    where: { id: shipment.id },
    data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() },
  });
  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      orderId: shipment.orderId,
      entityType: "FreightShipment",
      entityId: shipment.id,
      eventType: "freight_label_downloaded",
      summary: "Freight label downloaded",
      metadata: {},
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  return {
    outcome: "recorded",
    labelStorageKey: shipment.labelStorageKey,
    carrierName: shipment.carrierName,
  };
}
