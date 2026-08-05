import { IntegrationType, JobStatus, Severity } from "@prisma/client";
import { db } from "~/lib/db.server";
import { env } from "~/lib/env.server";
import { ShopifyGraphQLError } from "~/adapters/shopify/client.server";
import { importShopifyOrder, OrderNotFoundError } from "~/domain/orders/import-order.server";
import {
  recordIntegrationFailure,
  recordIntegrationSuccessAfterFailure,
} from "~/domain/integrations/record-failure.server";

interface OrderImportJobPayload {
  shopifyOrderGid?: string;
}

// Exported so reconcile-fulfillment-status.server.ts (the background
// fulfillment-sync sweep) can classify/report failures the exact same way,
// rather than inventing a second opinion on what counts as retryable.

// Never let a raw secret value end up in a stored failure record, even
// though none of our error paths currently embed one.
export function sanitizeTechnicalDetail(message: string): string {
  return message
    .split(env.SHOPIFY_ADMIN_API_TOKEN)
    .join("[redacted]")
    .split(env.SHOPIFY_API_SECRET_KEY)
    .join("[redacted]");
}

export function classifyFailure(error: unknown): {
  severity: Severity;
  retryable: boolean;
  summary: string;
} {
  if (error instanceof OrderNotFoundError) {
    return {
      severity: Severity.MEDIUM,
      retryable: false,
      summary: "Shopify order could not be found",
    };
  }
  if (error instanceof ShopifyGraphQLError) {
    return {
      severity: Severity.MEDIUM,
      retryable: true,
      summary: "Shopify GraphQL request failed",
    };
  }
  return { severity: Severity.HIGH, retryable: true, summary: "Order import failed unexpectedly" };
}

// Drains exactly one ShopifySyncJob: calls the shared import service, and
// records success/failure. Called both by the fire-and-forget kick from a
// webhook route and by the safety-net poller — safe to call twice for the
// same job (SUCCESS/RUNNING jobs are no-ops).
export async function processShopifySyncJob(jobId: string): Promise<void> {
  const job = await db.shopifySyncJob.findUnique({ where: { id: jobId } });

  if (!job || job.status === JobStatus.SUCCESS || job.status === JobStatus.RUNNING) {
    return;
  }

  await db.shopifySyncJob.update({ where: { id: job.id }, data: { status: JobStatus.RUNNING } });

  const payload = job.payload as OrderImportJobPayload | null;
  const shopifyOrderGid = payload?.shopifyOrderGid;
  const failureAction = `order-import:${shopifyOrderGid ?? job.id}`;

  if (!shopifyOrderGid) {
    await db.shopifySyncJob.update({
      where: { id: job.id },
      data: { status: JobStatus.FAILED, lastError: "Job payload is missing shopifyOrderGid" },
    });
    await recordIntegrationFailure({
      shopId: job.shopId,
      integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
      action: failureAction,
      summary: "Sync job payload was malformed",
      technicalDetail: "payload.shopifyOrderGid was missing or not a string",
      severity: Severity.HIGH,
      retryable: false,
    });
    return;
  }

  try {
    const result = await importShopifyOrder(job.shopId, shopifyOrderGid);

    await db.shopifySyncJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.SUCCESS,
        completedAt: new Date(),
        nextRetryAt: null,
        orderId: result.orderId,
      },
    });

    await recordIntegrationSuccessAfterFailure(
      job.shopId,
      IntegrationType.SHOPIFY_ORDER_IMPORT,
      failureAction,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { severity, retryable, summary } = classifyFailure(error);

    const failure = await recordIntegrationFailure({
      shopId: job.shopId,
      integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
      action: failureAction,
      summary,
      technicalDetail: sanitizeTechnicalDetail(message),
      severity,
      retryable,
    });

    await db.shopifySyncJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        attempts: { increment: 1 },
        lastError: sanitizeTechnicalDetail(message),
        nextRetryAt: retryable ? failure.nextRetryAt : null,
      },
    });
  }
}
