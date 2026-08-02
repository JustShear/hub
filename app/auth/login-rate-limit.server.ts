const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface AttemptWindow {
  count: number;
  windowStartedAt: number;
}

// In-memory, per-process — acceptable under ADR-0001's single-instance
// constraint (same rationale as the in-process job poller). Resets on
// deploy/restart; that's a deliberate tradeoff, not an oversight — a
// persistent store would need its own migration and cleanup job for what's
// a lightweight brute-force deterrent, not an audit trail.
const attemptsByKey = new Map<string, AttemptWindow>();

function keyFor(email: string, ip: string | null): string {
  return `${email.trim().toLowerCase()}|${ip ?? "unknown"}`;
}

export interface LoginRateLimitCheck {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/** Call before verifying credentials — does not itself record the attempt. */
export function checkLoginRateLimit(email: string, ip: string | null): LoginRateLimitCheck {
  const key = keyFor(email, ip);
  const window = attemptsByKey.get(key);
  if (!window) return { allowed: true };

  const elapsedMs = Date.now() - window.windowStartedAt;
  if (elapsedMs > WINDOW_MS) {
    attemptsByKey.delete(key);
    return { allowed: true };
  }

  if (window.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((WINDOW_MS - elapsedMs) / 1000) };
  }

  return { allowed: true };
}

/** Call after a failed authentication attempt. */
export function recordFailedLoginAttempt(email: string, ip: string | null): void {
  const key = keyFor(email, ip);
  const window = attemptsByKey.get(key);
  const now = Date.now();

  if (!window || now - window.windowStartedAt > WINDOW_MS) {
    attemptsByKey.set(key, { count: 1, windowStartedAt: now });
    return;
  }

  window.count += 1;
}

/** Call after a successful authentication — a real login clears the count. */
export function clearLoginAttempts(email: string, ip: string | null): void {
  attemptsByKey.delete(keyFor(email, ip));
}
