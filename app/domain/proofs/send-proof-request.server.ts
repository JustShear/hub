import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { env } from "~/lib/env.server";
import { OPEN_STATUSES } from "~/domain/integrations/record-failure.server";
import {
  computeProofTokenExpiry,
  generateProofToken,
  hashProofToken,
} from "~/auth/proof-token.server";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";
import { dispatchQueuedKlaviyoEvent } from "~/domain/proofs/dispatch-klaviyo-event.server";
import { scheduleProofReminder } from "~/domain/proofs/schedule-proof-reminder.server";
import { syncOrderLifecycleTag } from "~/domain/orders/sync-order-lifecycle-tag.server";

export interface SendProofRequestInput {
  shopId: string;
  orderId: string;
  proofGroupIds: string[];
  staffMessage: string | null;
  staffUserId: string;
}

export type SendProofRequestResult =
  // rawToken is returned only to this direct caller, at creation time — the
  // one exception to "never expose the raw token again" in the token
  // design (see app/auth/proof-token.server.ts). It exists here so a
  // legitimate caller of this function (e.g. a future support workflow, or
  // the seed script's own manual-verification fixtures) can act on the
  // link it just created; the internal HTTP route deliberately does NOT
  // forward this field to the browser response.
  | { outcome: "sent"; proofRequestId: string; rawToken: string }
  | { outcome: "rejected"; reason: string; issues?: string[] };

// A concurrency conflict (another send/status-change won the race between
// our validation read and this transaction's write) is surfaced as a
// rejection, not an unhandled throw — the caller just sees "try again."
class SendConflictError extends Error {}

export async function sendProofRequest(
  input: SendProofRequestInput,
): Promise<SendProofRequestResult> {
  if (input.proofGroupIds.length === 0) {
    return { outcome: "rejected", reason: "Select at least one proof group to send." };
  }

  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }
  if (order.cancelledAt) {
    return { outcome: "rejected", reason: "This order is cancelled — a proof cannot be sent." };
  }
  const customerEmail = order.customerEmail?.trim();
  if (!customerEmail) {
    return { outcome: "rejected", reason: "This order has no usable customer email on file." };
  }

  const groups = await db.proofGroup.findMany({
    where: { id: { in: input.proofGroupIds }, orderId: order.id },
    include: {
      proofRequirement: true,
      orderLines: true,
      versions: {
        where: { status: { notIn: ["CANCELLED", "SUPERSEDED"] } },
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: { assets: true },
      },
    },
  });
  if (groups.length !== input.proofGroupIds.length) {
    return {
      outcome: "rejected",
      reason: "One or more selected proof groups could not be found on this order.",
    };
  }

  const openFailures = await db.integrationFailure.findMany({
    where: { relatedProofGroupId: { in: groups.map((g) => g.id) }, status: { in: OPEN_STATUSES } },
    select: { relatedProofGroupId: true },
  });
  const blockedGroupIds = new Set(
    openFailures.map((f) => f.relatedProofGroupId).filter((id): id is string => id !== null),
  );

  const issues: string[] = [];
  for (const group of groups) {
    const label = `"${group.name}"`;
    if (group.status === "CANCELLED") {
      issues.push(`${label} is cancelled.`);
      continue;
    }
    if (group.proofRequirement?.value !== "REQUIRED") {
      issues.push(`${label} is not marked "proof required."`);
    }
    if (group.orderLines.length === 0) {
      issues.push(`${label} has no linked order line.`);
    }
    if (blockedGroupIds.has(group.id)) {
      issues.push(`${label} is blocked by an unresolved upload or storage issue.`);
    }
    const currentVersion = group.versions[0];
    if (!currentVersion) {
      issues.push(`${label} has no proof version yet.`);
    } else if (currentVersion.status !== "READY_TO_SEND") {
      issues.push(`${label}'s current version is not marked ready to send.`);
    } else if (currentVersion.assets.length === 0) {
      issues.push(`${label}'s current version has no uploaded proof file.`);
    }
    if (group.status !== "READY_TO_SEND") {
      issues.push(`${label} is not marked ready to send.`);
    }
  }
  if (issues.length > 0) {
    return {
      outcome: "rejected",
      reason: "One or more selected proof groups are not ready to send.",
      issues,
    };
  }

  // flatMap rather than map+non-null-assertion — every group is already
  // guaranteed a current version by the issues check above, but this stays
  // provably safe without asserting it.
  const groupVersionPairs = groups.flatMap((g) => {
    const currentVersion = g.versions[0];
    if (!currentVersion) return [];
    return [
      {
        proofGroupId: g.id,
        proofGroupName: g.name,
        proofVersionId: currentVersion.id,
        versionNumber: currentVersion.versionNumber,
      },
    ];
  });

  const rawToken = generateProofToken();
  const tokenHash = hashProofToken(rawToken);
  const tokenExpiresAt = computeProofTokenExpiry();
  const now = new Date();

  let dispatchId: string;
  let proofRequestId: string;
  try {
    const result = await db.$transaction(async (tx) => {
      const proofRequest = await tx.proofRequest.create({
        data: {
          shopId: input.shopId,
          orderId: order.id,
          customerEmail,
          customerName: order.customerName,
          tokenHash,
          tokenExpiresAt,
          status: "SENT",
          staffMessage: input.staffMessage,
          createdByStaffId: input.staffUserId,
          sentAt: now,
        },
      });

      await tx.proofRequestGroup.createMany({
        data: groupVersionPairs.map((pair) => ({
          proofRequestId: proofRequest.id,
          proofGroupId: pair.proofGroupId,
          proofVersionId: pair.proofVersionId,
        })),
      });

      const groupUpdate = await tx.proofGroup.updateMany({
        where: {
          id: { in: groupVersionPairs.map((p) => p.proofGroupId) },
          status: "READY_TO_SEND",
        },
        data: { status: "SENT" },
      });
      if (groupUpdate.count !== groupVersionPairs.length) {
        throw new SendConflictError();
      }

      const versionUpdate = await tx.proofVersion.updateMany({
        where: {
          id: { in: groupVersionPairs.map((p) => p.proofVersionId) },
          status: "READY_TO_SEND",
        },
        data: { status: "SENT", sentAt: now },
      });
      if (versionUpdate.count !== groupVersionPairs.length) {
        throw new SendConflictError();
      }

      await tx.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: order.id,
          entityType: "ProofRequest",
          entityId: proofRequest.id,
          eventType: "proof_request_created",
          summary: `Proof request sent to ${customerEmail} for order ${order.orderNumber} (${groupVersionPairs.length} proof group${groupVersionPairs.length === 1 ? "" : "s"})`,
          metadata: { proofGroupIds: groupVersionPairs.map((p) => p.proofGroupId) },
          actorStaffId: input.staffUserId,
          actorType: ActorType.STAFF,
        },
      });

      for (const pair of groupVersionPairs) {
        await tx.activityEvent.create({
          data: {
            shopId: input.shopId,
            orderId: order.id,
            entityType: "ProofGroup",
            entityId: pair.proofGroupId,
            eventType: "proof_group_sent",
            summary: `Proof group "${pair.proofGroupName}" sent to customer (version ${pair.versionNumber})`,
            metadata: { proofRequestId: proofRequest.id, proofVersionId: pair.proofVersionId },
            actorStaffId: input.staffUserId,
            actorType: ActorType.STAFF,
          },
        });
      }

      const reviewUrl = new URL(`/proof/${rawToken}`, env.APP_BASE_URL).toString();
      const dispatch = await tx.klaviyoDispatch.create({
        data: {
          shopId: input.shopId,
          eventType: "PROOF_SENT",
          klaviyoMetricName: "Proof Ready For Review",
          recipientEmail: customerEmail,
          orderId: order.id,
          proofRequestId: proofRequest.id,
          eventProperties: {
            order_number: order.orderNumber,
            customer_first_name: (order.customerName ?? "").split(" ")[0] ?? "",
            review_proof_button: reviewUrl,
            proof_group_count: groupVersionPairs.length,
          },
          status: "QUEUED",
          idempotencyKey: `proof_sent:${proofRequest.id}`,
        },
      });

      await recalculateOrderProofSummary(tx, {
        shopId: input.shopId,
        orderId: order.id,
        actorStaffId: input.staffUserId,
      });

      await scheduleProofReminder(tx, proofRequest.id);

      return { proofRequestId: proofRequest.id, dispatchId: dispatch.id };
    });
    proofRequestId = result.proofRequestId;
    dispatchId = result.dispatchId;
  } catch (error) {
    if (error instanceof SendConflictError) {
      return {
        outcome: "rejected",
        reason:
          "One or more selected proof groups changed since you loaded this page — please retry.",
      };
    }
    throw error;
  }

  // Delivery is attempted outside the transaction (no network calls inside
  // a DB transaction) — a failure here is recorded on the KlaviyoDispatch/
  // IntegrationFailure rows, never rolled back into the proof-request send
  // itself, which has already genuinely happened from this app's side.
  await dispatchQueuedKlaviyoEvent(dispatchId);

  try {
    // removeTags covers the re-proofing case — a corrected proof sent after
    // changes were requested must clear the stale rejection tag, otherwise
    // "Changes Requested" would outrank "Proof Sent" on the board forever.
    await syncOrderLifecycleTag({
      shopId: input.shopId,
      orderId: order.id,
      addTag: "proof_sent",
      removeTags: ["proof_rejected", "proof_accepted"],
    });
  } catch {
    // Defensive backstop only — syncOrderLifecycleTag records its own
    // failure via recordIntegrationFailure and never throws under normal
    // operation, same pattern as create-freight-shipment.server.ts's own
    // call to syncFreightTrackingToShopify.
  }

  return { outcome: "sent", proofRequestId, rawToken };
}
