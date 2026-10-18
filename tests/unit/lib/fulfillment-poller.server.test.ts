import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reconcile = vi.fn(() =>
  Promise.resolve({ checked: 0, movedToFulfilled: 0, unchanged: 0, failed: 0 }),
);
vi.mock("~/domain/orders/reconcile-fulfillment-status.server", () => ({
  reconcileFulfillmentStatus: reconcile,
}));

describe("startFulfillmentPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reconcile.mockClear();
    global.__fulfillmentPollerStarted = undefined;
    global.__fulfillmentPollerRunning = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a first sweep shortly after start-up, not only after the full interval", async () => {
    const { startFulfillmentPoller } = await import("~/lib/fulfillment-poller.server");
    startFulfillmentPoller();
    expect(reconcile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("keeps sweeping every 30 minutes and starts only once", async () => {
    const { startFulfillmentPoller } = await import("~/lib/fulfillment-poller.server");
    startFulfillmentPoller();
    startFulfillmentPoller();
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    expect(reconcile).toHaveBeenCalledTimes(2); // start-up sweep + first interval
  });
});
