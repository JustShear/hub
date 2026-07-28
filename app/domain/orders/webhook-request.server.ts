import { IntegrationType, Severity, type Shop } from "@prisma/client";
import { db } from "~/lib/db.server";
import { env } from "~/lib/env.server";
import { verifyShopifyWebhookHmac } from "~/adapters/shopify/webhook-verify.server";
import { recordIntegrationFailure } from "~/domain/integrations/record-failure.server";

export interface VerifiedWebhook {
  ok: true;
  shop: Shop;
  body: unknown;
  webhookId: string;
  topic: string;
}

export interface RejectedWebhook {
  ok: false;
  response: Response;
}

// Shared by every webhook route: verify authenticity BEFORE trusting
// anything in the body, including the shop domain header. Invalid
// signatures are rejected immediately and never queued or retried.
export async function verifyAndParseShopifyWebhook(
  request: Request,
): Promise<VerifiedWebhook | RejectedWebhook> {
  const rawBody = await request.text();
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  const shopDomainHeader = request.headers.get("X-Shopify-Shop-Domain");
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");
  const topic = request.headers.get("X-Shopify-Topic") ?? "unknown";

  const isValidSignature = verifyShopifyWebhookHmac(
    rawBody,
    hmacHeader,
    env.SHOPIFY_API_SECRET_KEY,
  );
  const shop = await db.shop.findFirst();

  if (!isValidSignature) {
    if (shop) {
      await recordIntegrationFailure({
        shopId: shop.id,
        integration: IntegrationType.WEBHOOK,
        action: `webhook-signature:${topic}`,
        summary: "Webhook signature verification failed",
        technicalDetail: `topic=${topic}, hasHmacHeader=${Boolean(hmacHeader)}`,
        severity: Severity.HIGH,
        retryable: false,
      });
    }
    return { ok: false, response: new Response("Invalid signature", { status: 401 }) };
  }

  // Never trust the shop-domain header just because the signature is valid
  // for *some* secret we hold — confirm it matches the shop we expect.
  if (shop?.shopifyDomain !== shopDomainHeader) {
    return { ok: false, response: new Response("Unknown shop", { status: 404 }) };
  }

  if (!webhookId) {
    return { ok: false, response: new Response("Missing X-Shopify-Webhook-Id", { status: 400 }) };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return { ok: false, response: new Response("Invalid JSON body", { status: 400 }) };
  }

  return { ok: true, shop, body, webhookId, topic };
}
