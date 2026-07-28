import { createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { env } from "~/lib/env.server";
import { action as dataRequestAction } from "~/routes/webhooks.customers-data-request";
import { action as customersRedactAction } from "~/routes/webhooks.customers-redact";
import { action as shopRedactAction } from "~/routes/webhooks.shop-redact";

function sign(body: string): string {
  return createHmac("sha256", env.SHOPIFY_API_SECRET_KEY).update(body, "utf8").digest("base64");
}

function buildRequest(path: string, body: unknown, shopDomain: string, webhookId: string) {
  const rawBody = JSON.stringify(body);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": sign(rawBody),
      "X-Shopify-Shop-Domain": shopDomain,
      "X-Shopify-Webhook-Id": webhookId,
      "X-Shopify-Topic": "customers/redact",
    },
    body: rawBody,
  });
}

async function getShop() {
  return db.shop.findFirstOrThrow();
}

describe("privacy webhooks (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdActivityEventIds: string[] = [];
  const createdFailureIds: string[] = [];

  afterAll(async () => {
    if (createdActivityEventIds.length > 0) {
      await db.activityEvent.deleteMany({ where: { id: { in: createdActivityEventIds } } });
    }
    if (createdOrderIds.length > 0) {
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdFailureIds.length > 0) {
      await db.integrationAttempt.deleteMany({ where: { failureId: { in: createdFailureIds } } });
      await db.integrationFailure.deleteMany({ where: { id: { in: createdFailureIds } } });
    }
  });

  it("customers/data_request logs an activity event and a NEEDS_ATTENTION failure for manual follow-up", async () => {
    const shop = await getShop();
    const webhookId = randomUUID();
    const request = buildRequest(
      "/webhooks/customers/data-request",
      { customer: { email: "requester@example.com" }, orders_requested: [123] },
      shop.shopifyDomain,
      webhookId,
    );

    const response = await dataRequestAction({ request, params: {}, context: {} } as never);
    expect(response.status).toBe(200);

    const event = await db.activityEvent.findFirst({
      where: { shopId: shop.id, eventType: "CUSTOMER_DATA_REQUEST" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect(event?.summary).toContain("requester@example.com");
    expect(event?.summary).toContain("No data has been assembled or sent automatically");
    if (event) createdActivityEventIds.push(event.id);

    const failure = await db.integrationFailure.findFirst({
      where: { action: `customer-data-request:${webhookId}` },
    });
    expect(failure).not.toBeNull();
    expect(failure?.status).toBe("NEEDS_ATTENTION");
    if (failure) createdFailureIds.push(failure.id);
  });

  it("customers/redact anonymises matching ShopifyOrder rows, without deleting them, and flags the partial scope", async () => {
    const shop = await getShop();
    const email = `redact-me-${randomUUID()}@example.com`;
    const webhookId = randomUUID();

    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: "#9001",
        shopifyCreatedAt: new Date(),
        customerEmail: email,
        customerName: "Real Customer Name",
        customerPhone: "+61400000000",
        tags: [],
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);

    const request = buildRequest(
      "/webhooks/customers/redact",
      { customer: { email }, orders_to_redact: [] },
      shop.shopifyDomain,
      webhookId,
    );

    const response = await customersRedactAction({ request, params: {}, context: {} } as never);
    expect(response.status).toBe(200);

    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.customerEmail).toBeNull();
    expect(updated.customerName).toBe("[redacted]");
    expect(updated.customerPhone).toBeNull();
    expect(updated.orderNumber).toBe("#9001"); // order itself preserved, not deleted

    const event = await db.activityEvent.findFirst({
      where: { shopId: shop.id, eventType: "CUSTOMER_REDACT" },
      orderBy: { createdAt: "desc" },
    });
    expect(event?.summary).toContain("Partial customer redaction only");
    expect(event?.summary).not.toContain("complete");
    if (event) createdActivityEventIds.push(event.id);

    const failure = await db.integrationFailure.findFirst({
      where: { action: `customer-redact:${webhookId}` },
    });
    expect(failure).not.toBeNull();
    expect(failure?.status).toBe("NEEDS_ATTENTION");
    if (failure) createdFailureIds.push(failure.id);
  });

  it("shop/redact logs receipt and a CRITICAL failure, never claiming automated erasure occurred", async () => {
    const shop = await getShop();
    const webhookId = randomUUID();
    const request = buildRequest(
      "/webhooks/shop/redact",
      { shop_id: 1 },
      shop.shopifyDomain,
      webhookId,
    );

    const response = await shopRedactAction({ request, params: {}, context: {} } as never);
    expect(response.status).toBe(200);

    const event = await db.activityEvent.findFirst({
      where: { shopId: shop.id, eventType: "SHOP_REDACT" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    expect(event?.summary).toContain("NO data has been erased or anonymised automatically");
    if (event) createdActivityEventIds.push(event.id);

    const failure = await db.integrationFailure.findFirst({
      where: { action: `shop-redact:${webhookId}` },
    });
    expect(failure).not.toBeNull();
    expect(failure?.severity).toBe("CRITICAL");
    expect(failure?.status).toBe("NEEDS_ATTENTION");
    if (failure) createdFailureIds.push(failure.id);

    // The shop itself must still exist — this webhook must not have deleted it.
    const stillExists = await db.shop.findUnique({ where: { id: shop.id } });
    expect(stillExists).not.toBeNull();
  });
});
