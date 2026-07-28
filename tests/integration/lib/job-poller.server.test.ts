import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncDirection } from "@prisma/client";
import { db } from "~/lib/db.server";

vi.mock("~/domain/orders/process-sync-job.server", () => ({
  processShopifySyncJob: vi.fn().mockResolvedValue(undefined),
}));

const { processShopifySyncJob } = await import("~/domain/orders/process-sync-job.server");
const { drainDueJobs } = await import("~/lib/job-poller.server");

async function createJob(overrides: {
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  nextRetryAt?: Date | null;
}) {
  const shop = await db.shop.findFirstOrThrow();
  return db.shopifySyncJob.create({
    data: {
      shopId: shop.id,
      direction: SyncDirection.INBOUND,
      jobType: "orders/create",
      payload: { shopifyOrderGid: `gid://shopify/Order/${randomUUID()}` },
      idempotencyKey: randomUUID(),
      status: overrides.status,
      nextRetryAt: overrides.nextRetryAt,
    },
  });
}

describe("drainDueJobs (integration)", () => {
  const createdJobIds: string[] = [];

  beforeEach(() => {
    vi.mocked(processShopifySyncJob).mockClear();
  });

  afterAll(async () => {
    if (createdJobIds.length > 0) {
      await db.shopifySyncJob.deleteMany({ where: { id: { in: createdJobIds } } });
    }
  });

  it("processes a PENDING job with no nextRetryAt", async () => {
    const job = await createJob({ status: "PENDING", nextRetryAt: null });
    createdJobIds.push(job.id);

    await drainDueJobs();

    expect(processShopifySyncJob).toHaveBeenCalledWith(job.id);
  });

  it("processes a FAILED job whose retry time has passed", async () => {
    const job = await createJob({ status: "FAILED", nextRetryAt: new Date(Date.now() - 1000) });
    createdJobIds.push(job.id);

    await drainDueJobs();

    expect(processShopifySyncJob).toHaveBeenCalledWith(job.id);
  });

  it("skips a FAILED job whose retry time is still in the future", async () => {
    const job = await createJob({ status: "FAILED", nextRetryAt: new Date(Date.now() + 60_000) });
    createdJobIds.push(job.id);

    await drainDueJobs();

    expect(processShopifySyncJob).not.toHaveBeenCalledWith(job.id);
  });

  it("skips jobs that are already RUNNING or SUCCESS", async () => {
    const running = await createJob({ status: "RUNNING" });
    const success = await createJob({ status: "SUCCESS" });
    createdJobIds.push(running.id, success.id);

    await drainDueJobs();

    expect(processShopifySyncJob).not.toHaveBeenCalledWith(running.id);
    expect(processShopifySyncJob).not.toHaveBeenCalledWith(success.id);
  });
});
