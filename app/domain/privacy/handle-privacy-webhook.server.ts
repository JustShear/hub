import { ActorType, IntegrationType, Severity } from "@prisma/client";
import { db } from "~/lib/db.server";
import { verifyAndParseShopifyWebhook } from "~/domain/orders/webhook-request.server";
import { recordIntegrationFailure } from "~/domain/integrations/record-failure.server";

// See docs/decisions/0002-deferred-shopify-privacy-erasure.md (BLOCKING
// BEFORE PRODUCTION). Every handler below is honest about exactly what it
// did and did not do — none of them may claim or imply complete erasure.
// Each also records a non-retryable IntegrationFailure (NEEDS_ATTENTION) so
// the required manual follow-up is visible through the same failure queue
// staff already use, not buried only in an activity log nobody has reason
// to check.

interface CustomerDataRequestBody {
  customer?: { id?: number; email?: string; phone?: string };
  orders_requested?: number[];
}

interface CustomerRedactBody {
  customer?: { id?: number; email?: string; phone?: string };
  orders_to_redact?: number[];
}

// Shopify expects an app to separately (manually) provide the merchant with
// the requested data within its compliance window — this webhook is just the
// trigger to do so. No data payload is assembled or returned automatically.
export async function handleCustomerDataRequest(request: Request): Promise<Response> {
  const verified = await verifyAndParseShopifyWebhook(request);
  if (!verified.ok) return verified.response;

  const body = verified.body as CustomerDataRequestBody;
  const customerDescriptor = body.customer?.email ?? body.customer?.id ?? "unknown customer";

  await db.activityEvent.create({
    data: {
      shopId: verified.shop.id,
      entityType: "PrivacyRequest",
      entityId: verified.webhookId,
      eventType: "CUSTOMER_DATA_REQUEST",
      summary: `Customer data request received for ${String(customerDescriptor)}. No data has been assembled or sent automatically — Shopify requires manual fulfilment within its compliance window.`,
      metadata: { customer: body.customer, ordersRequested: body.orders_requested },
      actorType: ActorType.SYSTEM,
    },
  });

  await recordIntegrationFailure({
    shopId: verified.shop.id,
    integration: IntegrationType.WEBHOOK,
    action: `customer-data-request:${verified.webhookId}`,
    summary: `Manual action required: assemble and send customer data for ${String(customerDescriptor)}`,
    technicalDetail:
      "customers/data_request webhook received — no automated fulfilment exists yet.",
    severity: Severity.HIGH,
    retryable: false,
  });

  return new Response(null, { status: 200 });
}

// Partial, real action: anonymises the customer's PII on ShopifyOrder rows
// only. Does NOT touch the other models known to potentially carry this
// customer's data (proof messages, artwork asset URLs, activity/audit
// summaries, Klaviyo dispatch records, raw payloads, and others — full
// inventory in ADR-0002). Does not delete orders, lines, proofs, or any
// operational history.
export async function handleCustomerRedact(request: Request): Promise<Response> {
  const verified = await verifyAndParseShopifyWebhook(request);
  if (!verified.ok) return verified.response;

  const body = verified.body as CustomerRedactBody;
  const email = body.customer?.email;

  let redactedCount = 0;
  if (email) {
    const result = await db.shopifyOrder.updateMany({
      where: { shopId: verified.shop.id, customerEmail: email },
      data: {
        customerEmail: null,
        customerName: "[redacted]",
        customerPhone: null,
        shippingAddress: { redacted: true },
        billingAddress: { redacted: true },
      },
    });
    redactedCount = result.count;
  }

  await db.activityEvent.create({
    data: {
      shopId: verified.shop.id,
      entityType: "PrivacyRequest",
      entityId: verified.webhookId,
      eventType: "CUSTOMER_REDACT",
      summary: `Partial customer redaction only: anonymised ${redactedCount} ShopifyOrder row(s). This does NOT cover raw payloads, proof messages, artwork asset URLs, activity history, or Klaviyo dispatch records that may still reference this customer — see ADR-0002 for the full model inventory requiring manual review.`,
      metadata: { customer: body.customer, ordersToRedact: body.orders_to_redact, redactedCount },
      actorType: ActorType.SYSTEM,
    },
  });

  await recordIntegrationFailure({
    shopId: verified.shop.id,
    integration: IntegrationType.WEBHOOK,
    action: `customer-redact:${verified.webhookId}`,
    summary: `Manual review required: customer redaction only partially completed (${redactedCount} order(s) anonymised; other models not covered)`,
    technicalDetail:
      "customers/redact webhook processed — see ADR-0002 for models not yet covered.",
    severity: Severity.HIGH,
    retryable: false,
  });

  return new Response(null, { status: 200 });
}

// No automated shop-data erasure of any kind happens here. This is a
// deliberate, documented decision (ADR-0002), not an oversight — building
// this safely requires a dedicated milestone. This handler only
// acknowledges receipt and creates a durable record for manual follow-up.
export async function handleShopRedact(request: Request): Promise<Response> {
  const verified = await verifyAndParseShopifyWebhook(request);
  if (!verified.ok) return verified.response;

  await db.activityEvent.create({
    data: {
      shopId: verified.shop.id,
      entityType: "PrivacyRequest",
      entityId: verified.webhookId,
      eventType: "SHOP_REDACT",
      summary:
        "Shop redaction webhook received. NO data has been erased or anonymised automatically. Full manual data-erasure review is required — see docs/decisions/0002-deferred-shopify-privacy-erasure.md. This is a production-readiness blocker, not routine cleanup.",
      actorType: ActorType.SYSTEM,
    },
  });

  await recordIntegrationFailure({
    shopId: verified.shop.id,
    integration: IntegrationType.WEBHOOK,
    action: `shop-redact:${verified.webhookId}`,
    summary:
      "CRITICAL: shop/redact received — full manual data-erasure review required, nothing erased automatically",
    technicalDetail:
      "shop/redact webhook received — see ADR-0002. No automated erasure exists yet.",
    severity: Severity.CRITICAL,
    retryable: false,
  });

  return new Response(null, { status: 200 });
}
