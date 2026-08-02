// One-time pre-cutover backfill for the Kanban board's tag-driven columns
// (see docs/decisions/0013-kanban-lifecycle-tags-and-pack-column.md). Column
// placement switched from `workflowStatus`/`proofSummary` to Shopify tags
// for six columns — every order already in one of those states needs the
// real Shopify tag written *before* the new column logic goes live, or it
// silently falls back to "New" the moment this ships.
//
// Computes, for every active (non-special-status) order, what the OLD
// board-columns.ts logic would have placed it in, and calls the real
// syncOrderLifecycleTag (a genuine Shopify tagsAdd) so Shopify carries the
// correct tag. Orders whose old column has no new-tag equivalent (New,
// Proof Being Prepared/WAITING_CUSTOMER, Pack, Fulfilled) need no action —
// they already place correctly via workflowStatus/the fulfilled special
// view without any tag.
//
// Defaults to a dry run (prints what it WOULD tag, touches nothing). Pass
// --apply to actually write tags to Shopify.
//
// Usage:
//   npx tsx scripts/backfill-lifecycle-tags.ts            # dry run
//   npx tsx scripts/backfill-lifecycle-tags.ts --apply     # writes for real

import { OrderStatus, OrderProofSummary } from "@prisma/client";
import { db } from "../app/lib/db.server";
import { syncOrderLifecycleTag } from "../app/domain/orders/sync-order-lifecycle-tag.server";

const OLD_EXPORTED_STATUSES: OrderStatus[] = [
  OrderStatus.PARTIALLY_EXPORTED,
  OrderStatus.EXPORTED_FOR_PRINT,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.PARTIALLY_COMPLETE,
];
const OLD_APPROVED_STATUSES: OrderStatus[] = [
  OrderStatus.PARTIALLY_APPROVED,
  OrderStatus.READY_FOR_EXPORT,
];
const SPECIAL_STATUSES: OrderStatus[] = [
  OrderStatus.ON_HOLD,
  OrderStatus.CANCELLED,
  OrderStatus.ARCHIVED,
  OrderStatus.FULFILLED,
];

interface BackfillPlanItem {
  orderId: string;
  orderNumber: string;
  addTag: string;
}

// Mirrors the OLD board-columns.ts priority order exactly (proofSummary
// checked before workflowStatus) — this is deliberately a one-time,
// throwaway replica of pre-redesign logic, not a shared import, since the
// real board-columns.ts has already moved on.
function planFor(order: {
  id: string;
  orderNumber: string;
  workflowStatus: OrderStatus;
  proofSummary: OrderProofSummary;
}): BackfillPlanItem | null {
  if (order.proofSummary === OrderProofSummary.CHANGES_REQUESTED) {
    return { orderId: order.id, orderNumber: order.orderNumber, addTag: "proof_rejected" };
  }
  if (order.proofSummary === OrderProofSummary.WAITING_ON_CUSTOMER) {
    return { orderId: order.id, orderNumber: order.orderNumber, addTag: "proof_sent" };
  }
  if (OLD_APPROVED_STATUSES.includes(order.workflowStatus)) {
    return { orderId: order.id, orderNumber: order.orderNumber, addTag: "proof_accepted" };
  }
  if (OLD_EXPORTED_STATUSES.includes(order.workflowStatus)) {
    return { orderId: order.id, orderNumber: order.orderNumber, addTag: "Exported for Print" };
  }
  // NEW, ARTWORK_REQUIRED/PROOFING_IN_PROGRESS/WAITING_CUSTOMER,
  // READY_TO_PACK/PACKING all still resolve correctly under the new logic
  // with zero tag needed.
  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const shop = await db.shop.findFirstOrThrow();

  const orders = await db.shopifyOrder.findMany({
    where: { shopId: shop.id, workflowStatus: { notIn: SPECIAL_STATUSES } },
    select: { id: true, orderNumber: true, workflowStatus: true, proofSummary: true, tags: true },
  });

  const plan = orders
    .map((order) => planFor(order))
    .filter((item): item is BackfillPlanItem => item !== null);

  console.log(
    `${apply ? "APPLYING" : "DRY RUN"}: ${plan.length} of ${orders.length} active orders need a lifecycle tag backfilled.`,
  );

  let succeeded = 0;
  let failed = 0;
  for (const item of plan) {
    if (!apply) {
      console.log(`  would tag ${item.orderNumber} -> "${item.addTag}"`);
      continue;
    }
    const result = await syncOrderLifecycleTag({
      shopId: shop.id,
      orderId: item.orderId,
      addTag: item.addTag,
      removeTags: [],
    });
    if (result.outcome === "synced") {
      succeeded += 1;
      console.log(`  tagged ${item.orderNumber} -> "${item.addTag}"`);
    } else {
      failed += 1;
      console.error(`  FAILED ${item.orderNumber} -> "${item.addTag}": ${result.reason}`);
    }
  }

  if (apply) {
    console.log(`Done: ${succeeded} tagged, ${failed} failed (see IntegrationFailure for detail).`);
  } else {
    console.log("Dry run complete — pass --apply to actually write these tags to Shopify.");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
