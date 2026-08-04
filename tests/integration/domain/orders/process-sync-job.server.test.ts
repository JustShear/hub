import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatus, SyncDirection } from "@prisma/client";
import { db } from "~/lib/db.server";
import { ShopifyGraphQLError } from "~/adapters/shopify/client.server";

vi.mock("~/domain/orders/import-order.server", () => ({
  importShopifyOrder: vi.fn(),
  OrderNotFoundError: class OrderNotFoundError extends Error {
    constructor(gid: string) {
      super(`Shopify order ${gid} was not found`);
      this.name = "OrderNotFoundError";
    }
  },
}));

const { importShopifyOrder, OrderNotFoundError } =
  await import("~/domain/orders/import-order.server");
const { processShopifySyncJob } = await import("~/domain/orders/process-sync-job.server");

async function createJob(
  payload: unknown = { shopifyOrderGid: `gid://shopify/Order/${randomUUID()}` },
) {
  const shop = await db.shop.findFirstOrThrow();
  return db.shopifySyncJob.create({
    data: {
      shopId: shop.id,
      direction: SyncDirection.INBOUND,
      jobType: "orders/create",
      payload: payload as never,
      idempotencyKey: randomUUID(),
    },
  });
}

// The success path sets ShopifySyncJob.orderId, which is a real foreign key
// to ShopifyOrder — the mocked importShopifyOrder result must return an id
// that actually exists, or the update itself fails with a constraint error.
async function createRealOrder() {
  const shop = await db.shop.findFirstOrThrow();
  return db.shopifyOrder.create({
    data: {
      shopId: shop.id,
      shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
      orderNumber: "#9999",
      shopifyCreatedAt: new Date(),
      tags: [],
      rawPayload: {},
    },
  });
}

describe("processShopifySyncJob (integration)", () => {
  const createdJobIds: string[] = [];
  const createdFailureIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeEach(() => {
    vi.mocked(importShopifyOrder).mockReset();
  });

  afterAll(async () => {
    if (createdFailureIds.length > 0) {
      await db.integrationAttempt.deleteMany({ where: { failureId: { in: createdFailureIds } } });
      await db.integrationFailure.deleteMany({ where: { id: { in: createdFailureIds } } });
    }
    if (createdJobIds.length > 0) {
      await db.shopifySyncJob.deleteMany({ where: { id: { in: createdJobIds } } });
    }
    if (createdOrderIds.length > 0) {
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
  });

  it("marks the job SUCCESS and records the resulting orderId", async () => {
    const job = await createJob();
    createdJobIds.push(job.id);
    const order = await createRealOrder();
    createdOrderIds.push(order.id);
    vi.mocked(importShopifyOrder).mockResolvedValue({
      orderId: order.id,
      wasNewOrder: true,
      wasCancelledJustNow: false,
      wasFulfilledJustNow: false,
      changeDescriptions: [],
    });

    await processShopifySyncJob(job.id);

    const updated = await db.shopifySyncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(JobStatus.SUCCESS);
    expect(updated.orderId).toBe(order.id);
    expect(updated.nextRetryAt).toBeNull();
  });

  it("marks the job FAILED with a scheduled retry on a retryable GraphQL error, and records an IntegrationFailure", async () => {
    const job = await createJob();
    createdJobIds.push(job.id);
    vi.mocked(importShopifyOrder).mockRejectedValue(
      new ShopifyGraphQLError("Shopify GraphQL request failed with status 500", { status: 500 }),
    );

    await processShopifySyncJob(job.id);

    const updated = await db.shopifySyncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(JobStatus.FAILED);
    expect(updated.attempts).toBe(1);
    expect(updated.nextRetryAt).not.toBeNull();

    const failure = await db.integrationFailure.findFirst({
      where: {
        action: `order-import:${(job.payload as { shopifyOrderGid: string }).shopifyOrderGid}`,
      },
    });
    expect(failure).not.toBeNull();
    expect(failure?.status).toBe("RETRYING");
    if (failure) createdFailureIds.push(failure.id);
  });

  it("marks the job FAILED with no retry when the order can't be found (non-retryable)", async () => {
    const job = await createJob();
    createdJobIds.push(job.id);
    const orderGid = (job.payload as { shopifyOrderGid: string }).shopifyOrderGid;
    vi.mocked(importShopifyOrder).mockRejectedValue(new OrderNotFoundError(orderGid));

    await processShopifySyncJob(job.id);

    const updated = await db.shopifySyncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(JobStatus.FAILED);
    expect(updated.nextRetryAt).toBeNull();

    const failure = await db.integrationFailure.findFirst({
      where: { action: `order-import:${orderGid}` },
    });
    expect(failure?.status).toBe("NEEDS_ATTENTION");
    if (failure) createdFailureIds.push(failure.id);
  });

  it("fails without calling the import service when the payload is malformed", async () => {
    const job = await createJob({ notAShopifyOrderGid: true });
    createdJobIds.push(job.id);

    await processShopifySyncJob(job.id);

    expect(importShopifyOrder).not.toHaveBeenCalled();
    const updated = await db.shopifySyncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(JobStatus.FAILED);

    const failure = await db.integrationFailure.findFirst({
      where: { action: `order-import:${job.id}` },
    });
    expect(failure).not.toBeNull();
    if (failure) createdFailureIds.push(failure.id);
  });

  it("is a no-op for a job that has already succeeded", async () => {
    const job = await createJob();
    createdJobIds.push(job.id);
    await db.shopifySyncJob.update({ where: { id: job.id }, data: { status: JobStatus.SUCCESS } });

    await processShopifySyncJob(job.id);

    expect(importShopifyOrder).not.toHaveBeenCalled();
  });

  it("resolves a prior failure when a retry of the same order succeeds", async () => {
    const job = await createJob();
    createdJobIds.push(job.id);
    const orderGid = (job.payload as { shopifyOrderGid: string }).shopifyOrderGid;

    vi.mocked(importShopifyOrder).mockRejectedValueOnce(new OrderNotFoundError(orderGid));
    await processShopifySyncJob(job.id);
    const failedJob = await db.shopifySyncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failedJob.status).toBe(JobStatus.FAILED);

    // Reset back to PENDING to simulate a manual/poller-driven retry of the same job.
    await db.shopifySyncJob.update({ where: { id: job.id }, data: { status: JobStatus.PENDING } });
    const order = await createRealOrder();
    createdOrderIds.push(order.id);
    vi.mocked(importShopifyOrder).mockResolvedValueOnce({
      orderId: order.id,
      wasNewOrder: false,
      wasCancelledJustNow: false,
      wasFulfilledJustNow: false,
      changeDescriptions: [],
    });
    await processShopifySyncJob(job.id);

    const succeededJob = await db.shopifySyncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(succeededJob.status).toBe(JobStatus.SUCCESS);

    const failure = await db.integrationFailure.findFirst({
      where: { action: `order-import:${orderGid}` },
    });
    expect(failure?.status).toBe("RESOLVED");
    if (failure) createdFailureIds.push(failure.id);
  });
});
