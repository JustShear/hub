import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import { env } from "~/lib/env.server";

vi.mock("~/domain/orders/process-sync-job.server", () => ({
  processShopifySyncJob: vi.fn().mockResolvedValue(undefined),
}));

const { processShopifySyncJob } = await import("~/domain/orders/process-sync-job.server");
const { action: ordersCreatedAction } = await import("~/routes/webhooks.orders-created");
const { action: ordersUpdatedAction } = await import("~/routes/webhooks.orders-updated");

function sign(body: string): string {
  return createHmac("sha256", env.SHOPIFY_API_SECRET_KEY).update(body, "utf8").digest("base64");
}

function buildRequest(options: {
  body: unknown;
  shopDomain?: string;
  webhookId?: string;
  validSignature?: boolean;
  topic?: string;
}) {
  const rawBody = JSON.stringify(options.body);
  const signature = options.validSignature === false ? "invalid-signature" : sign(rawBody);

  return new Request("http://localhost/webhooks/orders/created", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": signature,
      "X-Shopify-Shop-Domain": options.shopDomain ?? "",
      "X-Shopify-Webhook-Id": options.webhookId ?? randomUUID(),
      "X-Shopify-Topic": options.topic ?? "orders/create",
    },
    body: rawBody,
  });
}

async function getShop() {
  return db.shop.findFirstOrThrow();
}

describe("webhooks.orders-created action (integration)", () => {
  const createdJobIds: string[] = [];
  const createdFailureIds: string[] = [];

  beforeEach(() => {
    vi.mocked(processShopifySyncJob).mockClear();
  });

  afterAll(async () => {
    if (createdJobIds.length > 0) {
      await db.shopifySyncJob.deleteMany({ where: { id: { in: createdJobIds } } });
    }
    if (createdFailureIds.length > 0) {
      await db.integrationAttempt.deleteMany({ where: { failureId: { in: createdFailureIds } } });
      await db.integrationFailure.deleteMany({ where: { id: { in: createdFailureIds } } });
    }
  });

  it("accepts a validly signed webhook, enqueues a job, and kicks processing", async () => {
    const shop = await getShop();
    const orderGid = `gid://shopify/Order/${randomUUID()}`;
    const webhookId = randomUUID();

    const request = buildRequest({
      body: { admin_graphql_api_id: orderGid },
      shopDomain: shop.shopifyDomain,
      webhookId,
    });

    const response = await ordersCreatedAction({ request, params: {}, context: {} } as never);

    expect(response.status).toBe(200);

    const job = await db.shopifySyncJob.findUniqueOrThrow({ where: { idempotencyKey: webhookId } });
    createdJobIds.push(job.id);
    expect(job.payload).toEqual({ shopifyOrderGid: orderGid });
    expect(job.jobType).toBe("orders/create");

    expect(processShopifySyncJob).toHaveBeenCalledWith(job.id);
  });

  it("rejects a webhook with an invalid signature and never queues it", async () => {
    const shop = await getShop();
    const webhookId = randomUUID();

    const request = buildRequest({
      body: { admin_graphql_api_id: "gid://shopify/Order/1" },
      shopDomain: shop.shopifyDomain,
      webhookId,
      validSignature: false,
    });

    const response = await ordersCreatedAction({ request, params: {}, context: {} } as never);

    expect(response.status).toBe(401);

    const job = await db.shopifySyncJob.findUnique({ where: { idempotencyKey: webhookId } });
    expect(job).toBeNull();
    expect(processShopifySyncJob).not.toHaveBeenCalled();

    const failure = await db.integrationFailure.findFirst({
      where: { shopId: shop.id, action: "webhook-signature:orders/create" },
      orderBy: { latestFailureAt: "desc" },
    });
    expect(failure).not.toBeNull();
    expect(failure?.status).toBe("NEEDS_ATTENTION"); // non-retryable
    if (failure) createdFailureIds.push(failure.id);
  });

  it("does not create a duplicate job for the same webhook delivered twice", async () => {
    const shop = await getShop();
    const orderGid = `gid://shopify/Order/${randomUUID()}`;
    const webhookId = randomUUID();

    const firstRequest = buildRequest({
      body: { admin_graphql_api_id: orderGid },
      shopDomain: shop.shopifyDomain,
      webhookId,
    });
    const firstResponse = await ordersCreatedAction({
      request: firstRequest,
      params: {},
      context: {},
    } as never);
    expect(firstResponse.status).toBe(200);

    const secondRequest = buildRequest({
      body: { admin_graphql_api_id: orderGid },
      shopDomain: shop.shopifyDomain,
      webhookId,
    });
    const secondResponse = await ordersCreatedAction({
      request: secondRequest,
      params: {},
      context: {},
    } as never);
    expect(secondResponse.status).toBe(200);

    const jobs = await db.shopifySyncJob.findMany({ where: { idempotencyKey: webhookId } });
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    if (!job) throw new Error("expected exactly one job to exist");
    createdJobIds.push(job.id);

    // Only the first delivery should have kicked processing.
    expect(processShopifySyncJob).toHaveBeenCalledTimes(1);
  });

  it("rejects a webhook for a shop domain that doesn't match the configured shop", async () => {
    const webhookId = randomUUID();
    const request = buildRequest({
      body: { admin_graphql_api_id: "gid://shopify/Order/1" },
      shopDomain: "some-other-store.myshopify.com",
      webhookId,
    });

    const response = await ordersCreatedAction({ request, params: {}, context: {} } as never);

    expect(response.status).toBe(404);
    const job = await db.shopifySyncJob.findUnique({ where: { idempotencyKey: webhookId } });
    expect(job).toBeNull();
  });

  it("rejects a webhook body missing admin_graphql_api_id", async () => {
    const shop = await getShop();
    const request = buildRequest({ body: { foo: "bar" }, shopDomain: shop.shopifyDomain });

    const response = await ordersCreatedAction({ request, params: {}, context: {} } as never);

    expect(response.status).toBe(400);
  });

  it("the orders-updated route enqueues with jobType orders/updated", async () => {
    const shop = await getShop();
    const orderGid = `gid://shopify/Order/${randomUUID()}`;
    const webhookId = randomUUID();

    const request = buildRequest({
      body: { admin_graphql_api_id: orderGid },
      shopDomain: shop.shopifyDomain,
      webhookId,
      topic: "orders/updated",
    });

    const response = await ordersUpdatedAction({ request, params: {}, context: {} } as never);
    expect(response.status).toBe(200);

    const job = await db.shopifySyncJob.findUniqueOrThrow({ where: { idempotencyKey: webhookId } });
    createdJobIds.push(job.id);
    expect(job.jobType).toBe("orders/updated");
  });
});
