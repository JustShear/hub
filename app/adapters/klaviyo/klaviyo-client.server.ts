import { env } from "~/lib/env.server";

// Klaviyo owns the actual email send via a Flow built in the Klaviyo UI —
// this adapter only ever upserts a profile and tracks a custom event; it
// never renders or sends an email body itself. See
// docs/architecture/architecture-review.html and ADR-0004's sibling
// decision-log entries for why this app doesn't have a generic
// transactional-email adapter.
const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
// Pinned so a Klaviyo API change can't silently alter response shape —
// bump deliberately, not automatically.
const KLAVIYO_REVISION = "2024-10-15";

export type KlaviyoTrackEventResult =
  | { ok: true; klaviyoEventId: string | null }
  | { ok: false; errorSummary: string; retryable: boolean };

// A very small, dependency-free client — deliberately not a generic
// "email provider" abstraction (see docs/decisions), since Klaviyo's
// profile+event model doesn't map onto send/deliver/bounce the way a
// transactional-email API does.
async function klaviyoFetch(
  path: string,
  body: unknown,
): Promise<{ ok: true; id: string | null } | { ok: false; status: number; errorSummary: string }> {
  let response: Response;
  try {
    response = await fetch(`${KLAVIYO_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${env.KLAVIYO_API_KEY}`,
        "Content-Type": "application/json",
        revision: KLAVIYO_REVISION,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Network failure — never include the request body (which may carry a
    // customer email or, for event tracking, a proof link) in the error.
    return { ok: false, status: 0, errorSummary: "Network error contacting Klaviyo." };
  }

  if (response.ok) {
    let id: string | null = null;
    try {
      const parsed = (await response.json()) as { data?: { id?: string } };
      id = parsed.data?.id ?? null;
    } catch {
      // Klaviyo returns 202 with no body for some endpoints — a missing id
      // is expected, not an error.
    }
    return { ok: true, id };
  }

  // Only the HTTP status is ever recorded — never the response body, which
  // could echo back parts of the request (email address, event properties).
  return {
    ok: false,
    status: response.status,
    errorSummary: `Klaviyo API returned HTTP ${response.status}`,
  };
}

export async function upsertKlaviyoProfile(
  email: string,
  properties: Record<string, unknown>,
): Promise<KlaviyoTrackEventResult> {
  const result = await klaviyoFetch("/profiles/", {
    data: { type: "profile", attributes: { email, properties } },
  });
  if (result.ok) {
    return { ok: true, klaviyoEventId: result.id };
  }
  // 409 = profile already exists — not a failure, Klaviyo's own dedup.
  if (result.status === 409) {
    return { ok: true, klaviyoEventId: null };
  }
  return {
    ok: false,
    errorSummary: result.errorSummary,
    retryable: result.status === 0 || result.status >= 500 || result.status === 429,
  };
}

export async function trackKlaviyoEvent(params: {
  email: string;
  metricName: string;
  properties: Record<string, unknown>;
}): Promise<KlaviyoTrackEventResult> {
  const result = await klaviyoFetch("/events/", {
    data: {
      type: "event",
      attributes: {
        properties: params.properties,
        metric: { data: { type: "metric", attributes: { name: params.metricName } } },
        profile: { data: { type: "profile", attributes: { email: params.email } } },
      },
    },
  });
  if (result.ok) {
    return { ok: true, klaviyoEventId: result.id };
  }
  return {
    ok: false,
    errorSummary: result.errorSummary,
    // A permanently invalid request (4xx other than rate-limiting) is never
    // retried indefinitely — only transient/server-side/rate-limit failures are.
    retryable: result.status === 0 || result.status >= 500 || result.status === 429,
  };
}
