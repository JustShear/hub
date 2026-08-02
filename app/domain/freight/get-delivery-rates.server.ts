import { db } from "~/lib/db.server";
import {
  getDeliveryServices,
  type DeliveryServiceOption,
} from "~/adapters/starshipit/starshipit-client.server";
import { buildStarshipitDestination } from "~/domain/freight/parse-shipping-address";

export interface GetDeliveryRatesInput {
  shopId: string;
  orderId: string;
  weightKg: number;
  heightM: number | null;
  widthM: number | null;
  lengthM: number | null;
}

export type GetDeliveryRatesResult =
  | { outcome: "found"; services: DeliveryServiceOption[] }
  | { outcome: "rejected"; reason: string };

/**
 * A pure quote — never mutates anything, never touches FreightShipment.
 * Staff use this to compare real carrier options before committing to
 * createFreightShipment with a specific carrier/service (and the same
 * weight/dimensions entered here, so the price quoted matches the label
 * actually printed).
 */
export async function getDeliveryRates(
  input: GetDeliveryRatesInput,
): Promise<GetDeliveryRatesResult> {
  if (input.weightKg <= 0) {
    return { outcome: "rejected", reason: "Weight must be greater than zero." };
  }

  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  const destinationResult = buildStarshipitDestination(order.shippingAddress, order.customerName);
  if (!destinationResult.valid || !destinationResult.destination) {
    return {
      outcome: "rejected",
      reason: destinationResult.reason ?? "This order's shipping address is incomplete.",
    };
  }

  const result = await getDeliveryServices({
    destination: destinationResult.destination,
    weightKg: input.weightKg,
    heightM: input.heightM,
    widthM: input.widthM,
    lengthM: input.lengthM,
  });
  if (!result.ok) {
    return { outcome: "rejected", reason: result.errorSummary };
  }

  // Cheapest first — the whole point is to let staff quickly pick the best-value option.
  const sorted = [...result.services].sort((a, b) => {
    if (a.totalPrice === null) return 1;
    if (b.totalPrice === null) return -1;
    return a.totalPrice - b.totalPrice;
  });

  return { outcome: "found", services: sorted };
}
