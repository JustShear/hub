import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface CancelFreightShipmentInput {
  shopId: string;
  freightShipmentId: string;
  reason: string;
  staffUserId: string;
}

export type CancelFreightShipmentResult =
  { outcome: "cancelled" } | { outcome: "already_there" } | { outcome: "rejected"; reason: string };

/**
 * Internal record-correction only — never calls any Starshipit void/cancel
 * API (no such endpoint is confirmed in the public reference this
 * milestone). Voiding the actual label with the carrier remains a manual
 * process outside the Hub; see docs/development.md's known limitations.
 */
export async function cancelFreightShipment(
  input: CancelFreightShipmentInput,
): Promise<CancelFreightShipmentResult> {
  const shipment = await db.freightShipment.findFirst({
    where: { id: input.freightShipmentId, shopId: input.shopId },
  });
  if (!shipment) {
    return { outcome: "rejected", reason: "Freight shipment not found." };
  }
  if (shipment.status === "CANCELLED") {
    return { outcome: "already_there" };
  }

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required to cancel a freight shipment." };
  }

  const updateResult = await db.freightShipment.updateMany({
    where: { id: shipment.id, status: { in: ["PREPARING", "CREATED", "FAILED"] } },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: trimmedReason,
      cancelledByStaffId: input.staffUserId,
    },
  });
  if (updateResult.count === 0) {
    return { outcome: "already_there" };
  }

  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      orderId: shipment.orderId,
      entityType: "FreightShipment",
      entityId: shipment.id,
      eventType: "freight_shipment_cancelled",
      summary: `Freight shipment cancelled: ${trimmedReason}`,
      metadata: { reason: trimmedReason },
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  return { outcome: "cancelled" };
}
