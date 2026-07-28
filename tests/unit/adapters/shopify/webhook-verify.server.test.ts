import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyShopifyWebhookHmac } from "~/adapters/shopify/webhook-verify.server";

const SECRET = "test_webhook_secret_for_hmac_verification";

function signBody(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("verifyShopifyWebhookHmac", () => {
  it("accepts a correctly signed body", () => {
    const body = JSON.stringify({ id: "gid://shopify/Order/1" });
    expect(verifyShopifyWebhookHmac(body, signBody(body), SECRET)).toBe(true);
  });

  it("rejects a body signed with the wrong secret", () => {
    const body = JSON.stringify({ id: "gid://shopify/Order/1" });
    expect(verifyShopifyWebhookHmac(body, signBody(body, "wrong-secret"), SECRET)).toBe(false);
  });

  it("rejects a body that was tampered with after signing", () => {
    const originalBody = JSON.stringify({ id: "gid://shopify/Order/1" });
    const signature = signBody(originalBody);
    const tamperedBody = JSON.stringify({ id: "gid://shopify/Order/2" });

    expect(verifyShopifyWebhookHmac(tamperedBody, signature, SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    const body = JSON.stringify({ id: "gid://shopify/Order/1" });
    expect(verifyShopifyWebhookHmac(body, null, SECRET)).toBe(false);
  });

  it("rejects a header that isn't valid base64 without throwing", () => {
    const body = JSON.stringify({ id: "gid://shopify/Order/1" });
    expect(() => verifyShopifyWebhookHmac(body, "not-base64-!!!", SECRET)).not.toThrow();
    expect(verifyShopifyWebhookHmac(body, "not-base64-!!!", SECRET)).toBe(false);
  });
});
