import type { FreightShipmentStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { resolveStaffNames } from "~/domain/orders/staff-names.server";

export interface OrderDetailFreightShipment {
  id: string;
  status: FreightShipmentStatus;
  carrierCode: string;
  carrierServiceCode: string;
  packagingPresetName: string | null;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  hasLabel: boolean;
  downloadCount: number;
  shopifyFulfillmentId: string | null;
  createdByStaffId: string;
  createdByStaffName: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export async function loadFreightShipmentsForOrder(params: {
  shopId: string;
  orderId: string;
}): Promise<OrderDetailFreightShipment[]> {
  const shipments = await db.freightShipment.findMany({
    where: { orderId: params.orderId, shopId: params.shopId },
    orderBy: { createdAt: "desc" },
  });
  if (shipments.length === 0) return [];

  const staffNames = await resolveStaffNames(shipments.map((s) => s.createdByStaffId));

  return shipments.map((shipment) => ({
    id: shipment.id,
    status: shipment.status,
    carrierCode: shipment.carrierCode,
    carrierServiceCode: shipment.carrierServiceCode,
    packagingPresetName: shipment.packagingPresetName,
    carrierName: shipment.carrierName,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    hasLabel: shipment.labelStorageKey !== null,
    downloadCount: shipment.downloadCount,
    shopifyFulfillmentId: shipment.shopifyFulfillmentId,
    createdByStaffId: shipment.createdByStaffId,
    createdByStaffName: staffNames.get(shipment.createdByStaffId) ?? "Unknown staff member",
    createdAt: shipment.createdAt.toISOString(),
    cancelledAt: shipment.cancelledAt?.toISOString() ?? null,
    cancelReason: shipment.cancelReason,
  }));
}
