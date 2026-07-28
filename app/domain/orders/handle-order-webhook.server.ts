import { verifyAndParseShopifyWebhook } from "~/domain/orders/webhook-request.server";
import { enqueueOrderImportJob } from "~/domain/orders/enqueue-order-import.server";
import { processShopifySyncJob } from "~/domain/orders/process-sync-job.server";

interface ShopifyOrderWebhookBody {
  admin_graphql_api_id?: string;
}

// Shared by orders-created/updated/cancelled: all three converge on the same
// import service call (it always re-fetches and reconciles the complete
// current order state, cancellation included), so there's nothing
// topic-specific beyond the job label used for tracking.
export async function handleOrderWebhook(request: Request, jobType: string): Promise<Response> {
  const verified = await verifyAndParseShopifyWebhook(request);
  if (!verified.ok) {
    return verified.response;
  }

  const body = verified.body as ShopifyOrderWebhookBody;
  const shopifyOrderGid = body.admin_graphql_api_id;

  if (!shopifyOrderGid) {
    return new Response("Missing admin_graphql_api_id", { status: 400 });
  }

  const { jobId, wasNew } = await enqueueOrderImportJob(
    verified.shop.id,
    verified.webhookId,
    shopifyOrderGid,
    jobType,
  );

  // Respond fast — the real work happens after this. Fire-and-forget: safe
  // on a persistent Node server (Render), where the process keeps running
  // after the response is sent. The poller (see app/lib/job-poller.server.ts)
  // is the safety net if this in-flight call never completes (e.g. a restart).
  if (wasNew) {
    void processShopifySyncJob(jobId).catch((error: unknown) => {
      console.error("Fire-and-forget order import kick failed to start", error);
    });
  }

  return new Response(null, { status: 200 });
}
