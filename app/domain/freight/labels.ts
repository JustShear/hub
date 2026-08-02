import type { FreightShipmentStatus } from "@prisma/client";

export const FREIGHT_SHIPMENT_STATUS_LABELS: Record<FreightShipmentStatus, string> = {
  PREPARING: "Preparing",
  CREATED: "Created",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};
