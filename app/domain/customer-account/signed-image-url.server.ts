import { createHmac, timingSafeEqual } from "node:crypto";

// Short-lived, customer-bound links to proof images. The extension shows
// images with a plain <s-image src=...>, which cannot carry an
// Authorization header, so each image URL carries its own proof of
// authorisation: an HMAC over (asset, customer, expiry). The signature binds
// the link to ONE customer and ONE file, so a leaked or guessed URL cannot be
// used to reach anyone else's artwork, and it stops working when it expires.
// The image route also re-checks ownership at serve time - the signature is
// a gate, not the only check.

export const PROOF_IMAGE_URL_TTL_SECONDS = 60 * 60;

export interface ProofImageLinkClaims {
  assetId: string;
  customerId: string;
  /** Unix seconds. */
  expiresAt: number;
}

function signingKey(secret: string): Buffer {
  // Derived, domain-separated key: the raw app secret is never used directly
  // for anything other than Shopify's own token/webhook verification.
  return createHmac("sha256", secret).update("customer-account-proof-image-url-v1").digest();
}

function signature(claims: ProofImageLinkClaims, secret: string): string {
  return createHmac("sha256", signingKey(secret))
    .update(`${claims.assetId}.${claims.customerId}.${claims.expiresAt}`)
    .digest("hex");
}

export function buildProofImageUrl(input: {
  baseUrl: string;
  secret: string;
  assetId: string;
  customerId: string;
  nowMs?: number;
}): string {
  const expiresAt = Math.floor((input.nowMs ?? Date.now()) / 1000) + PROOF_IMAGE_URL_TTL_SECONDS;
  const claims = { assetId: input.assetId, customerId: input.customerId, expiresAt };
  const query = new URLSearchParams({
    cid: input.customerId,
    exp: String(expiresAt),
    sig: signature(claims, input.secret),
  });
  const base = input.baseUrl.replace(/\/+$/, "");
  return `${base}/api/customer-account/proof-image/${encodeURIComponent(input.assetId)}?${query.toString()}`;
}

export type ProofImageLinkResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: "malformed" | "expired" | "bad_signature" };

export function verifyProofImageLink(input: {
  assetId: string;
  searchParams: URLSearchParams;
  secret: string;
  nowMs?: number;
}): ProofImageLinkResult {
  const customerId = input.searchParams.get("cid") ?? "";
  const exp = input.searchParams.get("exp") ?? "";
  const sig = input.searchParams.get("sig") ?? "";
  if (!/^\d+$/.test(customerId) || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) {
    return { ok: false, reason: "malformed" };
  }

  const claims = { assetId: input.assetId, customerId, expiresAt: Number(exp) };
  const expected = Buffer.from(signature(claims, input.secret), "hex");
  const provided = Buffer.from(sig, "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  if (Math.floor((input.nowMs ?? Date.now()) / 1000) > claims.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, customerId };
}
