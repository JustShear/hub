import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { dispatchQueuedKlaviyoEvent } from "~/domain/proofs/dispatch-klaviyo-event.server";

const BATCH_SIZE = 20;

// Thrown when a concurrent suppression/second poller tick won the race
// against this reminder's own send — caught locally, no propagation needed.
class ReminderAlreadyResolvedError extends Error {}

/**
 * Polled alongside the Shopify sync job drain (see job-poller.server.ts).
 * Never re-attempts a reminder that's already SENT or suppressed — the
 * @@unique([proofRequestId]) constraint on ProofReminder means there is
 * only ever one reminder row per request, so "sent once" is structural,
 * not just a runtime check. A reminder that's become moot (request
 * completed/revoked/expired, or the order was cancelled) is silently
 * skipped rather than marked with its own "cancelled" status — that state
 * is derived at read time from the proof request's own status instead of
 * being duplicated onto the reminder row.
 */
export async function dispatchDueProofReminders(): Promise<void> {
  const now = new Date();
  const dueReminders = await db.proofReminder.findMany({
    where: { sentAt: null, suppressed: false, scheduledFor: { lte: now } },
    take: BATCH_SIZE,
    orderBy: { scheduledFor: "asc" },
    include: {
      proofRequest: {
        include: {
          order: { select: { cancelledAt: true } },
          groups: { include: { proofVersion: { select: { status: true } } } },
        },
      },
    },
  });

  for (const reminder of dueReminders) {
    await dispatchOneReminder(reminder);
  }
}

async function dispatchOneReminder(
  reminder: Awaited<ReturnType<typeof db.proofReminder.findMany>>[number] & {
    proofRequest: {
      id: string;
      shopId: string;
      orderId: string;
      customerEmail: string;
      status: string;
      revokedAt: Date | null;
      tokenExpiresAt: Date;
      order: { cancelledAt: Date | null };
      groups: { proofVersion: { status: string } }[];
    };
  },
): Promise<void> {
  const request = reminder.proofRequest;

  if (
    request.status === "COMPLETED" ||
    request.revokedAt ||
    request.tokenExpiresAt.getTime() < Date.now()
  ) {
    return;
  }
  if (request.order.cancelledAt) {
    return;
  }
  const hasUnresolvedGroup = request.groups.some(
    (g) => g.proofVersion.status === "SENT" || g.proofVersion.status === "VIEWED",
  );
  if (!hasUnresolvedGroup) {
    return;
  }

  const originalDispatch = await db.klaviyoDispatch.findFirst({
    where: { proofRequestId: request.id },
    orderBy: { queuedAt: "asc" },
  });
  if (!originalDispatch) {
    return;
  }

  let dispatchId: string;
  try {
    const created = await db.$transaction(async (tx) => {
      const dispatch = await tx.klaviyoDispatch.create({
        data: {
          shopId: request.shopId,
          eventType: "PROOF_REMINDER",
          klaviyoMetricName: "Proof Reminder",
          recipientEmail: request.customerEmail,
          orderId: request.orderId,
          proofRequestId: request.id,
          eventProperties: originalDispatch.eventProperties as object,
          status: "QUEUED",
          idempotencyKey: `proof_reminder:${request.id}`,
        },
      });

      const reminderUpdate = await tx.proofReminder.updateMany({
        where: { id: reminder.id, sentAt: null, suppressed: false },
        data: { sentAt: new Date(), klaviyoDispatchId: dispatch.id },
      });
      if (reminderUpdate.count === 0) {
        throw new ReminderAlreadyResolvedError();
      }

      await tx.activityEvent.create({
        data: {
          shopId: request.shopId,
          orderId: request.orderId,
          entityType: "ProofRequest",
          entityId: request.id,
          eventType: "proof_reminder_sent",
          summary: `Automatic reminder sent to ${request.customerEmail}`,
          actorType: ActorType.SYSTEM,
        },
      });

      return dispatch;
    });
    dispatchId = created.id;
  } catch (error) {
    if (error instanceof ReminderAlreadyResolvedError) {
      return;
    }
    throw error;
  }

  await dispatchQueuedKlaviyoEvent(dispatchId);
}
