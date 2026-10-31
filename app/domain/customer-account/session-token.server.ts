import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies the session token a Shopify customer-account UI extension sends
// (`shopify.sessionToken.get()` -> `Authorization: Bearer <jwt>`). It is the
// ONLY thing that tells the Hub which customer is asking, so it is strict:
// HS256 only (never "none", never an attacker-chosen algorithm), signature
// compared in constant time, and expiry / not-before / audience / shop /
// customer all checked. Nothing here trusts a value before the signature has
// been verified.

const CLOCK_SKEW_LEEWAY_SECONDS = 10;
const CUSTOMER_GID = /^gid:\/\/shopify\/Customer\/(\d+)$/;

export type SessionTokenFailure =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "wrong_audience"
  | "wrong_shop"
  | "no_customer";

export type SessionTokenResult =
  | { ok: true; customerId: string; customerGid: string }
  | { ok: false; reason: SessionTokenFailure };

export interface VerifySessionTokenInput {
  /** The raw value of the Authorization header, e.g. "Bearer eyJ...". */
  authorizationHeader: string | null;
  /** The app's Client ID - the `aud` claim must equal this. */
  clientId: string;
  /** The app's client secret - the HS256 signing key. */
  secret: string;
  /** The shop's *.myshopify.com domain - the `dest` claim must name it. */
  shopDomain: string;
  /** Injectable for tests. */
  nowMs?: number;
}

function base64UrlToBuffer(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    return null;
  }
  return Buffer.from(value, "base64url");
}

function parseJsonObject(buffer: Buffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(buffer.toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normaliseShopHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export function verifyCustomerSessionToken(input: VerifySessionTokenInput): SessionTokenResult {
  const match = /^Bearer\s+(\S+)$/i.exec(input.authorizationHeader?.trim() ?? "");
  if (!match?.[1]) {
    return { ok: false, reason: "missing" };
  }

  const parts = match[1].split(".");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (parts.length !== 3 || !encodedHeader || !encodedPayload || !encodedSignature) {
    return { ok: false, reason: "malformed" };
  }

  const headerBytes = base64UrlToBuffer(encodedHeader);
  const payloadBytes = base64UrlToBuffer(encodedPayload);
  const signatureBytes = base64UrlToBuffer(encodedSignature);
  if (!headerBytes || !payloadBytes || !signatureBytes) {
    return { ok: false, reason: "malformed" };
  }

  const header = parseJsonObject(headerBytes);
  if (header?.alg !== "HS256") {
    return { ok: false, reason: "malformed" };
  }

  const expectedSignature = createHmac("sha256", input.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  if (
    signatureBytes.length !== expectedSignature.length ||
    !timingSafeEqual(signatureBytes, expectedSignature)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  // Signature is good: the payload is Shopify's. Still validate its claims.
  const payload = parseJsonObject(payloadBytes);
  if (!payload) {
    return { ok: false, reason: "malformed" };
  }

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const { exp, nbf, aud, dest, sub } = payload;

  if (typeof exp !== "number" || nowSeconds > exp + CLOCK_SKEW_LEEWAY_SECONDS) {
    return { ok: false, reason: "expired" };
  }
  if (typeof nbf === "number" && nowSeconds < nbf - CLOCK_SKEW_LEEWAY_SECONDS) {
    return { ok: false, reason: "not_yet_valid" };
  }

  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(input.clientId)) {
    return { ok: false, reason: "wrong_audience" };
  }

  if (typeof dest !== "string" || normaliseShopHost(dest) !== normaliseShopHost(input.shopDomain)) {
    return { ok: false, reason: "wrong_shop" };
  }

  // `sub` is only present for a signed-in customer, and only when the app
  // has the read_customers scope.
  const customerMatch = typeof sub === "string" ? CUSTOMER_GID.exec(sub) : null;
  if (!customerMatch?.[1]) {
    return { ok: false, reason: "no_customer" };
  }

  return { ok: true, customerId: customerMatch[1], customerGid: customerMatch[0] };
}
