import { describe, expect, it } from "vitest";
import { computeNextRetryDelayMs } from "~/domain/integrations/record-failure.server";

describe("computeNextRetryDelayMs", () => {
  it("doubles the delay for each successive attempt", () => {
    const first = computeNextRetryDelayMs(1);
    const second = computeNextRetryDelayMs(2);
    const third = computeNextRetryDelayMs(3);

    expect(second).toBe(first * 2);
    expect(third).toBe(first * 4);
  });

  it("caps the delay so it never grows unbounded", () => {
    const delayAt20Attempts = computeNextRetryDelayMs(20);
    const delayAt30Attempts = computeNextRetryDelayMs(30);

    expect(delayAt20Attempts).toBe(delayAt30Attempts);
    expect(delayAt20Attempts).toBeLessThanOrEqual(60 * 60_000);
  });

  it("starts at a sane base delay, not near-zero", () => {
    expect(computeNextRetryDelayMs(1)).toBeGreaterThanOrEqual(30_000);
  });
});
