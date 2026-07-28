import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies the `X-Shopify-Hmac-Sha256` header against the raw (unparsed)
// request body. Must run on the exact raw bytes Shopify signed — parsing
// JSON first and re-serializing would not necessarily round-trip to the same
// bytes and would break verification.
export function verifyShopifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
  secret: string,
): boolean {
  if (!hmacHeader) {
    return false;
  }

  const computedDigest = createHmac("sha256", secret).update(rawBody, "utf8").digest();

  let providedDigest: Buffer;
  try {
    providedDigest = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }

  if (providedDigest.length !== computedDigest.length) {
    return false;
  }

  return timingSafeEqual(computedDigest, providedDigest);
}
