import { db } from "~/lib/db.server";
import { SPECIAL_STATUSES } from "~/domain/orders/board-columns";

// Shop-requested fixed list for the Dashboard's "products on order" tiles —
// not derived from any catalog, just the specific products they want a
// running count of. Add/remove names here to change the tiles.
export const TRACKED_PRODUCT_TITLES = [
  "Burning Diesel",
  "Flat Out like a Lizard Drinking",
  "Converting Fuel into Good Times",
  "Bank of Dad",
  "Dad's Day",
  "Just Shear",
];

export interface ProductFulfillmentMetric {
  productTitle: string;
  unfulfilledQuantity: number;
}

// Case/whitespace-insensitive — Shopify's own title casing isn't guaranteed
// to stay byte-identical to what's typed into TRACKED_PRODUCT_TITLES.
function normalize(title: string): string {
  return title.trim().toLowerCase();
}

// Real counts only — no invented targets/percentages, same convention as
// warehouse/exceptions' own dashboard-metrics.server.ts files. Scoped to
// currently-active orders the same way the board is (workflowStatus not in
// SPECIAL_STATUSES — on hold/cancelled/archived/fulfilled orders don't
// count), then unfulfilled units per line = quantity minus fulfilledQuantity
// (Shopify's own line-level fulfillment split, already imported).
export async function getProductFulfillmentMetrics(
  shopId: string,
): Promise<ProductFulfillmentMetric[]> {
  const lines = await db.shopifyOrderLine.findMany({
    where: {
      order: { shopId, workflowStatus: { notIn: Object.values(SPECIAL_STATUSES) } },
      productTitle: { in: TRACKED_PRODUCT_TITLES, mode: "insensitive" },
    },
    select: { productTitle: true, quantity: true, fulfilledQuantity: true },
  });

  const totals = new Map<string, number>();
  for (const line of lines) {
    const unfulfilled = Math.max(0, line.quantity - (line.fulfilledQuantity ?? 0));
    const key = normalize(line.productTitle);
    totals.set(key, (totals.get(key) ?? 0) + unfulfilled);
  }

  return TRACKED_PRODUCT_TITLES.map((productTitle) => ({
    productTitle,
    unfulfilledQuantity: totals.get(normalize(productTitle)) ?? 0,
  }));
}
