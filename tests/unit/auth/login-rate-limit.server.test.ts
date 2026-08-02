import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  recordFailedLoginAttempt,
} from "~/auth/login-rate-limit.server";

// Each test uses its own randomised email so the module-level attempt map
// (deliberately in-memory/per-process — see login-rate-limit.server.ts)
// never leaks state between tests.
function uniqueEmail() {
  return `${randomUUID()}@example.test`;
}

describe("login rate limiting", () => {
  it("allows attempts under the threshold", () => {
    const email = uniqueEmail();
    for (let i = 0; i < 4; i++) {
      expect(checkLoginRateLimit(email, "1.2.3.4").allowed).toBe(true);
      recordFailedLoginAttempt(email, "1.2.3.4");
    }
    expect(checkLoginRateLimit(email, "1.2.3.4").allowed).toBe(true);
  });

  it("blocks once the failure threshold is reached, with a retry-after", () => {
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) {
      recordFailedLoginAttempt(email, "1.2.3.4");
    }
    const result = checkLoginRateLimit(email, "1.2.3.4");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks email+IP independently — a different IP for the same email isn't blocked", () => {
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) {
      recordFailedLoginAttempt(email, "1.2.3.4");
    }
    expect(checkLoginRateLimit(email, "1.2.3.4").allowed).toBe(false);
    expect(checkLoginRateLimit(email, "9.9.9.9").allowed).toBe(true);
  });

  it("a successful login clears the recorded attempts", () => {
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) {
      recordFailedLoginAttempt(email, "1.2.3.4");
    }
    expect(checkLoginRateLimit(email, "1.2.3.4").allowed).toBe(false);

    clearLoginAttempts(email, "1.2.3.4");
    expect(checkLoginRateLimit(email, "1.2.3.4").allowed).toBe(true);
  });

  it("normalises email case so attempts against the same account combine", () => {
    const base = randomUUID();
    const lower = `${base}@example.test`;
    const upper = `${base.toUpperCase()}@EXAMPLE.TEST`;
    for (let i = 0; i < 5; i++) {
      recordFailedLoginAttempt(lower, "1.2.3.4");
    }
    expect(checkLoginRateLimit(upper, "1.2.3.4").allowed).toBe(false);
  });
});
