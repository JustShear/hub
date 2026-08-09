// One-time backfill for orders that gained the "Exported for Print" Shopify
// tag before the warehouse pick-job trigger existed (see
// move-order-workflow-status.server.ts and import-order.server.ts) — those
// orders never fired the new trigger, so they'd otherwise never get a
// WarehousePickJob. Finds every active order tagged "Exported for Print"
// with no existing pick job and creates one via the real, idempotent
// createWarehousePickJobForOrder — safe to re-run.
//
// Defaults to a dry run (lists what's currently missing a pick job, touches
// nothing). Pass --apply to actually create them.
//
// Usage:
//   npm run backfill:warehouse-pick-jobs            # dry run
//   npm run backfill:warehouse-pick-jobs -- --apply  # creates pick jobs for real

import { db } from "../app/lib/db.server";
import { SPECIAL_STATUSES } from "../app/domain/orders/board-columns";
import { createWarehousePickJobForOrder } from "../app/domain/warehouse/create-warehouse-pick-job.server";

async function findOrdersMissingPickJob() {
  const shop = await db.shop.findFirstOrThrow();
  return db.shopifyOrder.findMany({
    where: {
      shopId: shop.id,
      workflowStatus: { notIn: Object.values(SPECIAL_STATUSES) },
      tags: { has: "Exported for Print" },
      warehousePickJob: null,
    },
    select: { id: true, orderNumber: true },
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const shop = await db.shop.findFirstOrThrow();
  const orders = await findOrdersMissingPickJob();

  if (!apply) {
    console.log(
      `DRY RUN: ${orders.length} order(s) tagged "Exported for Print" have no WarehousePickJob.`,
    );
    for (const order of orders) {
      console.log(`  would create a pick job for ${order.orderNumber}`);
    }
    console.log("Dry run complete — pass --apply to actually create these pick jobs.");
    return;
  }

  console.log(`APPLYING: creating pick jobs for ${orders.length} order(s)...`);
  let created = 0;
  for (const order of orders) {
    await db.$transaction((tx) =>
      createWarehousePickJobForOrder(tx, {
        shopId: shop.id,
        orderId: order.id,
        actorStaffId: null,
      }),
    );
    const pickJob = await db.warehousePickJob.findUnique({ where: { orderId: order.id } });
    if (pickJob) {
      created += 1;
      console.log(`  created pick job for ${order.orderNumber}`);
    } else {
      console.log(`  skipped ${order.orderNumber} (no order lines)`);
    }
  }
  console.log(`Done: ${created} pick job(s) created out of ${orders.length} candidate order(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
