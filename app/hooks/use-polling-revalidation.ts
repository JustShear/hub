import { useEffect } from "react";
import { useRevalidator } from "react-router";

/** Pure decision of whether a poll tick should actually trigger a revalidation — isolated so it's testable without mocking React Router internals. */
export function shouldPollTick(
  revalidatorState: "idle" | "loading" | "submitting",
  documentVisibilityState: DocumentVisibilityState,
): boolean {
  return revalidatorState === "idle" && documentVisibilityState !== "hidden";
}

/**
 * Lightweight real-time refresh (Milestone 16) — re-runs every active loader
 * on the current route tree on an interval, so a queue/board page picks up
 * changes made by other staff without an explicit navigation or reload.
 * Deliberately client-side revalidation, not a server push (SSE/WebSockets)
 * — this app is constrained to a single instance with no cross-instance
 * coordination (ADR-0001), and polling needs none.
 *
 * Paused while the tab is hidden (`document.visibilityState`) so a
 * backgrounded tab doesn't keep polling, and skipped entirely while a
 * revalidation or navigation is already in flight.
 */
export function usePollingRevalidation(intervalMs = 20_000): void {
  const revalidator = useRevalidator();

  useEffect(() => {
    const tick = () => {
      if (!shouldPollTick(revalidator.state, document.visibilityState)) return;
      void revalidator.revalidate();
    };

    const intervalId = setInterval(tick, intervalMs);
    return () => {
      clearInterval(intervalId);
    };
    // `tick` always reads the latest `revalidator` via closure over this
    // effect's own scope, so omitting it from the deps array is deliberate —
    // including it would restart (and desync) the interval every time
    // `revalidator.state` changes, which happens on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
}
