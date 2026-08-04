// One-time catch-up for the FULFILLED auto-sync fix added to
// importShopifyOrder (see app/domain/orders/import-order.server.ts's
// wasFulfilledJustNow logic). That fix only runs when an order is
// re-synced — it never retroactively re-checks orders already sitting in
// the Hub. Any order fulfilled directly in Shopify before that fix shipped
// (or before its own next webhook/import) is stuck showing in Pack forever,
// since nothing else ever re-queries Shopify for its current state.
//
// Unlike scripts/import-open-orders.ts (which discovers orders via
// Shopify's "status:open" search — a search that explicitly EXCLUDES
// already-fulfilled orders, so it can never catch this), this script finds
// its candidates from the Hub's own database: every order currently in the
// Pack column (the exact same query the board itself uses, via
// getBoardColumn("pack").where), then re-runs the real importShopifyOrder
// for each so the FULFILLED-detection guard gets a chance to fire.
//
// Defaults to a dry run (lists what's currently in Pack, touches nothing).
// Pass --apply to actually re-sync each one against Shopify.
//
// Usage:
//   npm run backfill:pack-fulfillment-sync            # dry run
//   npm run backfill:pack-fulfillment-sync -- --apply  # re-syncs for real

import { db } from "../app/lib/db.server";
import { getBoardColumn } from "../app/domain/orders/board-columns";
import { importShopifyOrder } from "../app/domain/orders/import-order.server";

// Same rationale as import-open-orders.ts — a one-time script has no
// urgency to go fast, so it stays well under Shopify's rate limits.
const DELAY_BETWEEN_ORDERS_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const shop = await db.shop.findFirstOrThrow();

  const packOrders = await db.shopifyOrder.findMany({
    where: { shopId: shop.id, ...getBoardColumn("pack").where },
    select: { id: true, shopifyOrderGid: true, orderNumber: true },
  });

  console.log(
    `${apply ? "APPLYING" : "DRY RUN"}: ${packOrders.length} order(s) currently in Pack.`,
  );

  if (!apply) {
    for (const order of packOrders) {
      console.log(`  would re-sync ${order.orderNumber} (${order.shopifyOrderGid})`);
    }
    console.log("Dry run complete — pass --apply to actually re-sync these against Shopify.");
    return;
  }

  let movedToFulfilled = 0;
  let unchanged = 0;
  let failed = 0;
  for (const order of packOrders) {
    try {
      const result = await importShopifyOrder(shop.id, order.shopifyOrderGid);
      if (result.wasFulfilledJustNow) {
        movedToFulfilled += 1;
        console.log(`  ${order.orderNumber}: moved to Fulfilled`);
      } else {
        unchanged += 1;
        console.log(`  ${order.orderNumber}: still genuinely in Pack, unchanged`);
      }
    } catch (error) {
      failed += 1;
      console.error(
        `  FAILED ${order.orderNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await sleep(DELAY_BETWEEN_ORDERS_MS);
  }

  console.log(
    `Done: ${movedToFulfilled} moved to Fulfilled, ${unchanged} unchanged, ${failed} failed.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
