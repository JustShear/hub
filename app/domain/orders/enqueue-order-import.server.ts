import { Prisma, SyncDirection } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface EnqueueResult {
  jobId: string;
  wasNew: boolean;
}

// Idempotent on Shopify's own webhook delivery ID — a duplicate delivery
// hits the unique constraint and is treated as already-queued rather than
// spawning a second job (SRS: "safely handle webhook delivery more than
// once", "prevent duplicate ... events").
export async function enqueueOrderImportJob(
  shopId: string,
  webhookId: string,
  shopifyOrderGid: string,
  jobType: string,
): Promise<EnqueueResult> {
  try {
    const job = await db.shopifySyncJob.create({
      data: {
        shopId,
        direction: SyncDirection.INBOUND,
        jobType,
        payload: { shopifyOrderGid },
        idempotencyKey: webhookId,
      },
    });
    return { jobId: job.id, wasNew: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.shopifySyncJob.findUniqueOrThrow({
        where: { idempotencyKey: webhookId },
      });
      return { jobId: existing.id, wasNew: false };
    }
    throw error;
  }
}
