import { IntegrationType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { SPECIAL_STATUSES } from "~/domain/orders/board-columns";
import { importShopifyOrder } from "~/domain/orders/import-order.server";
import { classifyFailure, sanitizeTechnicalDetail } from "~/domain/orders/process-sync-job.server";
import {
  recordIntegrationFailure,
  recordIntegrationSuccessAfterFailure,
} from "~/domain/integrations/record-failure.server";

// The shared engine behind both scripts/backfill-fulfillment-sync.ts (a
// one-off manual run) and app/lib/fulfillment-poller.server.ts (the ongoing
// background sweep) — one implementation, so the two can never drift apart.
//
// Re-syncs every order currently active on the board (i.e. not already
// on_hold/cancelled/archived/fulfilled) against real Shopify data, giving
// importShopifyOrder's wasFulfilledJustNow guard a chance to fire for any
// order that was fulfilled directly in Shopify since its last sync. This
// exists because webhooks are the only thing that normally triggers a
// re-sync — nothing else notices a state change on an order already sitting
// in the Hub, so a missed or pre-cutover webhook would otherwise leave that
// order stuck on the wrong column forever.

// Same rationale as the one-off script this powers — no urgency to go fast,
// so this stays well under Shopify's rate limits even at higher order counts.
// Overridable (tests pass 0) since it otherwise scales with however many
// active orders currently exist for the shop.
const DEFAULT_DELAY_BETWEEN_ORDERS_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ReconcileFulfillmentStatusResult {
  checked: number;
  movedToFulfilled: number;
  unchanged: number;
  failed: number;
}

export async function reconcileFulfillmentStatus(
  options: { delayBetweenOrdersMs?: number } = {},
): Promise<ReconcileFulfillmentStatusResult> {
  const delayBetweenOrdersMs = options.delayBetweenOrdersMs ?? DEFAULT_DELAY_BETWEEN_ORDERS_MS;
  const shop = await db.shop.findFirstOrThrow();

  const activeOrders = await db.shopifyOrder.findMany({
    where: { shopId: shop.id, workflowStatus: { notIn: Object.values(SPECIAL_STATUSES) } },
    select: { id: true, shopifyOrderGid: true },
  });

  let movedToFulfilled = 0;
  let unchanged = 0;
  let failed = 0;

  for (const order of activeOrders) {
    // Same (shop, integration, action, relatedOrderId) key process-sync-job.server.ts
    // uses for the exact same underlying call, so a failure surfaced by this
    // background sweep and one surfaced by a webhook retry accumulate on the
    // same IntegrationFailure row rather than spawning duplicates.
    const failureAction = `order-import:${order.shopifyOrderGid}`;

    try {
      const result = await importShopifyOrder(shop.id, order.shopifyOrderGid);
      if (result.wasFulfilledJustNow) {
        movedToFulfilled += 1;
      } else {
        unchanged += 1;
      }
      await recordIntegrationSuccessAfterFailure(
        shop.id,
        IntegrationType.SHOPIFY_ORDER_IMPORT,
        failureAction,
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      const { severity, retryable, summary } = classifyFailure(error);
      await recordIntegrationFailure({
        shopId: shop.id,
        integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
        action: failureAction,
        relatedOrderId: order.id,
        summary,
        technicalDetail: sanitizeTechnicalDetail(message),
        severity,
        retryable,
      });
    }
    await sleep(delayBetweenOrdersMs);
  }

  return { checked: activeOrders.length, movedToFulfilled, unchanged, failed };
}
