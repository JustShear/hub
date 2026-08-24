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

// Case/whitespace-insensitive, and normalizes curly quotes to straight ones
// (Shopify/browser autocorrect can turn "Dad's Day" into "Dad’s Day") —
// matched as a SUBSTRING, not an exact title, since real product titles are
// very unlikely to be exactly one of these names verbatim (e.g. "Singlet —
// Burning Diesel" or "Burning Diesel / Navy / Large" as a variant title).
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[‘’]/g, "'");
}

// Real counts only — no invented targets/percentages, same convention as
// warehouse/exceptions' own dashboard-metrics.server.ts files. Scoped to
// currently-active orders the same way the board is (workflowStatus not in
// SPECIAL_STATUSES — on hold/cancelled/archived/fulfilled orders don't
// count), then unfulfilled units per line = quantity minus fulfilledQuantity
// (Shopify's own line-level fulfillment split, already imported). Checks
// both productTitle and variantTitle, since we don't know in advance which
// one actually carries the design name on a matching line — same reasoning
// as the board's own line-property marker matching.
export async function getProductFulfillmentMetrics(
  shopId: string,
): Promise<ProductFulfillmentMetric[]> {
  // Deliberately no productTitle/variantTitle filter at the DB level — a
  // Postgres `contains` runs against the raw bytes, so it wouldn't find a
  // curly-apostrophe "Dad’s Day" against a straight-apostrophe query string.
  // All substring matching happens in JS below, after normalize() has
  // already reconciled that kind of drift.
  const lines = await db.shopifyOrderLine.findMany({
    where: { order: { shopId, workflowStatus: { notIn: Object.values(SPECIAL_STATUSES) } } },
    select: { productTitle: true, variantTitle: true, quantity: true, fulfilledQuantity: true },
  });

  const totals = new Map<string, number>();
  for (const line of lines) {
    const unfulfilled = Math.max(0, line.quantity - (line.fulfilledQuantity ?? 0));
    if (unfulfilled === 0) continue;
    const haystack = normalize(`${line.productTitle} ${line.variantTitle ?? ""}`);
    for (const title of TRACKED_PRODUCT_TITLES) {
      if (haystack.includes(normalize(title))) {
        totals.set(title, (totals.get(title) ?? 0) + unfulfilled);
      }
    }
  }

  return TRACKED_PRODUCT_TITLES.map((productTitle) => ({
    productTitle,
    unfulfilledQuantity: totals.get(productTitle) ?? 0,
  }));
}
