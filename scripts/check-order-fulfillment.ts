// Read-only diagnostic: for each order number given, compares what the Hub has
// stored with what Shopify reports right now, and says what the fulfilment
// sweep would do with it. Writes nothing.
//
// Usage: npm run check:order-fulfillment -- 34577 37237 39019

import { db } from "../app/lib/db.server";
import { fetchShopifyOrder } from "../app/adapters/shopify/orders.server";
import { isSpecialStatus } from "../app/domain/orders/board-columns";

async function main() {
  const numbers = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (numbers.length === 0) {
    console.log("Pass one or more order numbers, e.g. npm run check:order-fulfillment -- 34577");
    return;
  }
  const shop = await db.shop.findFirstOrThrow();

  for (const raw of numbers) {
    const orderNumber = raw.startsWith("#") ? raw : `#${raw}`;
    console.log(`\n=== ${orderNumber} ===`);
    const local = await db.shopifyOrder.findFirst({
      where: { shopId: shop.id, orderNumber },
      select: {
        id: true,
        shopifyOrderGid: true,
        workflowStatus: true,
        fulfillmentStatus: true,
        cancelledAt: true,
        lastSyncedAt: true,
      },
    });
    if (!local) {
      console.log("Not in the Hub database at all.");
      continue;
    }
    console.log(
      `Hub: workflowStatus=${local.workflowStatus}, fulfillmentStatus=${local.fulfillmentStatus ?? "null"}, ` +
        `cancelledAt=${local.cancelledAt?.toISOString() ?? "null"}, lastSyncedAt=${local.lastSyncedAt?.toISOString() ?? "null"}`,
    );

    const failures = await db.integrationFailure.findMany({
      where: { relatedOrderId: local.id },
      orderBy: { latestFailureAt: "desc" },
      take: 3,
      select: {
        integration: true,
        status: true,
        summary: true,
        technicalDetail: true,
        latestFailureAt: true,
      },
    });
    for (const f of failures) {
      console.log(
        `Failure: ${f.integration} [${f.status}] ${f.summary} — ${f.technicalDetail ?? ""} (${f.latestFailureAt.toISOString()})`,
      );
    }

    try {
      const shopify = await fetchShopifyOrder(
        { shopDomain: shop.shopifyDomain, accessToken: shop.adminApiToken },
        local.shopifyOrderGid,
      );
      if (!shopify) {
        console.log("Shopify: order NOT FOUND (deleted, or not visible to this token).");
        continue;
      }
      console.log(
        `Shopify: displayFulfillmentStatus=${shopify.displayFulfillmentStatus}, cancelledAt=${shopify.cancelledAt ?? "null"}`,
      );
      const wouldMove =
        shopify.displayFulfillmentStatus === "FULFILLED" && !isSpecialStatus(local.workflowStatus);
      console.log(
        wouldMove
          ? "=> the sweep WOULD move this to Fulfilled."
          : `=> the sweep would NOT move this (Shopify status is ${shopify.displayFulfillmentStatus}, Hub status is ${local.workflowStatus}).`,
      );
    } catch (error) {
      console.log(
        `Shopify fetch FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
