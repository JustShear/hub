// One-time (or as-needed) manual run of the same sweep the background
// fulfillment poller (app/lib/fulfillment-poller.server.ts) now runs
// automatically every 30 minutes — see reconcile-fulfillment-status.server.ts
// for what it actually does and why. Useful for forcing an immediate catch-up
// (e.g. right after deploying the fix) instead of waiting for the next
// scheduled sweep.
//
// Defaults to a dry run (lists what's currently active on the board,
// touches nothing). Pass --apply to actually re-sync each one against
// Shopify.
//
// Usage:
//   npm run backfill:fulfillment-sync            # dry run
//   npm run backfill:fulfillment-sync -- --apply  # re-syncs for real

import { db } from "../app/lib/db.server";
import { SPECIAL_STATUSES } from "../app/domain/orders/board-columns";
import { reconcileFulfillmentStatus } from "../app/domain/orders/reconcile-fulfillment-status.server";

async function main() {
  const apply = process.argv.includes("--apply");

  if (!apply) {
    const shop = await db.shop.findFirstOrThrow();
    const activeOrders = await db.shopifyOrder.findMany({
      where: { shopId: shop.id, workflowStatus: { notIn: Object.values(SPECIAL_STATUSES) } },
      select: { orderNumber: true, workflowStatus: true },
    });
    console.log(`DRY RUN: ${activeOrders.length} order(s) currently active on the board.`);
    for (const order of activeOrders) {
      console.log(`  would re-sync ${order.orderNumber} (${order.workflowStatus})`);
    }
    console.log("Dry run complete — pass --apply to actually re-sync these against Shopify.");
    return;
  }

  console.log("APPLYING: re-syncing every active order against Shopify...");
  const result = await reconcileFulfillmentStatus();
  console.log(
    `Done: checked ${result.checked}, ${result.movedToFulfilled} moved to Fulfilled, ` +
      `${result.unchanged} unchanged, ${result.failed} failed.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
