import { db } from "~/lib/db.server";
import { trackKlaviyoEvent } from "~/adapters/klaviyo/klaviyo-client.server";
import {
  recordIntegrationFailure,
  recordIntegrationSuccessAfterFailure,
} from "~/domain/integrations/record-failure.server";

// Attempts a single queued KlaviyoDispatch row. Never throws — a failed
// customer notification must never take down the caller (the proof-send
// action itself already succeeded and committed; this is best-effort
// delivery on top of it). Idempotent: a dispatch already SENT/FAILED is
// left alone rather than re-attempted here — retrying a FAILED one is a
// deliberate staff action (see retry-proof-request-delivery.server.ts),
// never automatic on every call.
export async function dispatchQueuedKlaviyoEvent(dispatchId: string): Promise<void> {
  const dispatch = await db.klaviyoDispatch.findUnique({ where: { id: dispatchId } });
  if (dispatch?.status !== "QUEUED") {
    return;
  }

  const result = await trackKlaviyoEvent({
    email: dispatch.recipientEmail,
    metricName: dispatch.klaviyoMetricName,
    properties: dispatch.eventProperties as Record<string, unknown>,
  });

  if (result.ok) {
    await db.klaviyoDispatch.update({
      where: { id: dispatch.id },
      data: { status: "SENT", sentAt: new Date(), klaviyoEventId: result.klaviyoEventId },
    });
    await recordIntegrationSuccessAfterFailure(
      dispatch.shopId,
      "EMAIL",
      "klaviyo_dispatch",
      dispatch.orderId ?? undefined,
    );
    return;
  }

  await db.klaviyoDispatch.update({
    where: { id: dispatch.id },
    data: { status: "FAILED", failedAt: new Date(), retryCount: { increment: 1 } },
  });

  // technicalDetail is the HTTP-status-only summary from the adapter —
  // never the request body, so no customer email, proof link, or token
  // ever reaches the integration-failure log.
  await recordIntegrationFailure({
    shopId: dispatch.shopId,
    integration: "EMAIL",
    action: "klaviyo_dispatch",
    relatedOrderId: dispatch.orderId ?? undefined,
    summary: "Failed to notify the customer that a proof is ready for review.",
    technicalDetail: result.errorSummary,
    severity: "MEDIUM",
    retryable: result.retryable,
  });
}

// Staff-triggered retry of a FAILED dispatch — resets it to QUEUED first so
// dispatchQueuedKlaviyoEvent's own guard (only ever acts on QUEUED rows)
// applies uniformly, then attempts it immediately.
export async function retryFailedKlaviyoDispatch(dispatchId: string): Promise<void> {
  const updateResult = await db.klaviyoDispatch.updateMany({
    where: { id: dispatchId, status: "FAILED" },
    data: { status: "QUEUED" },
  });
  if (updateResult.count === 0) {
    return;
  }
  await dispatchQueuedKlaviyoEvent(dispatchId);
}
