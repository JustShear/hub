// One-time historical backfill: imports every currently-open Shopify order
// (Shopify's "not archived/cancelled" definition — see fetchOpenShopifyOrderGids)
// that predates this app's webhook registration. Webhooks only fire for
// orders created/updated/cancelled going forward — they never retroactively
// backfill orders that already existed in the store, so this script is the
// one-time catch-up for everything already open at cutover time.
//
// Calls the exact same importShopifyOrder used by webhooks and
// scripts/import-order.ts — no separate import implementation.
//
// Defaults to a dry run (lists what WOULD be imported, touches nothing).
// Pass --apply to actually write to the database.
//
// Usage:
//   npm run import:open-orders            # dry run
//   npm run import:open-orders -- --apply  # imports for real

import { db } from "../app/lib/db.server";
import { fetchOpenShopifyOrderGids } from "../app/adapters/shopify/orders.server";
import { importShopifyOrder } from "../app/domain/orders/import-order.server";

// Space out requests so a large backfill doesn't trip Shopify's GraphQL
// cost-based rate limiting — a one-time script has no urgency to go fast.
const DELAY_BETWEEN_ORDERS_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const shop = await db.shop.findFirstOrThrow();

  const orderGids = await fetchOpenShopifyOrderGids({
    shopDomain: shop.shopifyDomain,
    accessToken: shop.adminApiToken,
  });

  console.log(
    `${apply ? "APPLYING" : "DRY RUN"}: ${orderGids.length} open order(s) found in Shopify.`,
  );

  if (!apply) {
    for (const gid of orderGids) {
      console.log(`  would import ${gid}`);
    }
    console.log("Dry run complete — pass --apply to actually import these into the database.");
    return;
  }

  let imported = 0;
  let updated = 0;
  let failed = 0;
  for (const gid of orderGids) {
    try {
      const result = await importShopifyOrder(shop.id, gid);
      if (result.wasNewOrder) {
        imported += 1;
        console.log(`  imported ${gid} (order ${result.orderId})`);
      } else {
        updated += 1;
        console.log(`  already existed, refreshed ${gid} (order ${result.orderId})`);
      }
    } catch (error) {
      failed += 1;
      console.error(`  FAILED ${gid}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(DELAY_BETWEEN_ORDERS_MS);
  }

  console.log(`Done: ${imported} newly imported, ${updated} already existed, ${failed} failed.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
