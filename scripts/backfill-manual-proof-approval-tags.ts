// One-time backfill for a bug fixed in manually-approve-proof-version.server.ts:
// manuallyApproveProofVersion used to update internal proof-group state
// without ever syncing the real "proof_accepted" Shopify tag, so any order
// manually approved before the fix never moved to the Proof Approved column
// (order 36933 was the reported case).
//
// Finds every order with a MANUAL_PROOF_APPROVAL ManualOverride whose
// current proofSummary says it should carry "proof_accepted" but whose real
// Shopify tags don't yet have it, and calls the real syncOrderLifecycleTag
// for each. Uses the order's already-recalculated proofSummary column
// (recalculateOrderProofSummary ran correctly at approval time — only the
// post-transaction tag sync was missing, so nothing needs recomputing here).
//
// Defaults to a dry run (prints what it WOULD tag, touches nothing). Pass
// --apply to actually write tags to Shopify.
//
// Usage:
//   npx tsx scripts/backfill-manual-proof-approval-tags.ts            # dry run
//   npx tsx scripts/backfill-manual-proof-approval-tags.ts --apply     # writes for real

import { db } from "../app/lib/db.server";
import { syncOrderLifecycleTag } from "../app/domain/orders/sync-order-lifecycle-tag.server";

const APPROVED_SUMMARIES = ["PARTIALLY_APPROVED", "ALL_REQUIRED_PROOFS_APPROVED"];

async function main() {
  const apply = process.argv.includes("--apply");
  const shop = await db.shop.findFirstOrThrow();

  const overrides = await db.manualOverride.findMany({
    where: { shopId: shop.id, overrideType: "MANUAL_PROOF_APPROVAL" },
    select: { relatedEntityId: true },
  });
  const proofVersionIds = [...new Set(overrides.map((o) => o.relatedEntityId))];
  if (proofVersionIds.length === 0) {
    console.log("No MANUAL_PROOF_APPROVAL overrides found — nothing to backfill.");
    return;
  }

  const versions = await db.proofVersion.findMany({
    where: { id: { in: proofVersionIds } },
    select: { proofGroup: { select: { orderId: true } } },
  });
  const orderIds = [...new Set(versions.map((v) => v.proofGroup.orderId))];

  const orders = await db.shopifyOrder.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, orderNumber: true, proofSummary: true, tags: true },
  });

  const stuck = orders.filter(
    (order) => APPROVED_SUMMARIES.includes(order.proofSummary) && !order.tags.includes("proof_accepted"),
  );

  console.log(
    `${apply ? "APPLYING" : "DRY RUN"}: ${stuck.length} of ${orders.length} manually-approved orders are missing the "proof_accepted" tag.`,
  );

  let succeeded = 0;
  let failed = 0;
  for (const order of stuck) {
    if (!apply) {
      console.log(`  would tag ${order.orderNumber} -> "proof_accepted"`);
      continue;
    }
    const result = await syncOrderLifecycleTag({
      shopId: shop.id,
      orderId: order.id,
      addTag: "proof_accepted",
      removeTags: ["proof_sent", "proof_rejected"],
    });
    if (result.outcome === "synced") {
      succeeded += 1;
      console.log(`  tagged ${order.orderNumber} -> "proof_accepted"`);
    } else {
      failed += 1;
      console.error(`  FAILED ${order.orderNumber}: ${result.reason}`);
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
