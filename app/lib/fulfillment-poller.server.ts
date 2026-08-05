import { reconcileFulfillmentStatus } from "~/domain/orders/reconcile-fulfillment-status.server";

const POLL_INTERVAL_MS = 30 * 60_000; // 30 minutes

declare global {
  var __fulfillmentPollerStarted: boolean | undefined;
  var __fulfillmentPollerRunning: boolean | undefined;
}

// Background catch-up for orders fulfilled directly in Shopify: webhooks are
// the only thing that normally triggers a re-sync of an order already
// sitting in the Hub, so a missed webhook (or one that predates this app's
// webhook registration) would otherwise leave that order stuck on the wrong
// column forever — see reconcile-fulfillment-status.server.ts. Same
// idempotent-start pattern as startJobPoller: only the first call actually
// starts the interval, safe to call from a per-request loader.
export function startFulfillmentPoller(): void {
  if (global.__fulfillmentPollerStarted) {
    return;
  }
  global.__fulfillmentPollerStarted = true;

  setInterval(() => {
    // A full-board sweep can take longer than a single job-drain tick — this
    // guards against two sweeps overlapping if one is still in flight when
    // the next interval fires.
    if (global.__fulfillmentPollerRunning) {
      return;
    }
    global.__fulfillmentPollerRunning = true;
    void reconcileFulfillmentStatus()
      .catch((error: unknown) => {
        console.error("Fulfillment reconciliation poller iteration failed", error);
      })
      .finally(() => {
        global.__fulfillmentPollerRunning = false;
      });
  }, POLL_INTERVAL_MS).unref();
}
