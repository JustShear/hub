import { createHash, randomUUID } from "node:crypto";
import { ActorType, type ChangeRequestCategory, type OrderProofSummary } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";
import {
  PROOF_FILE_KIND_EXTENSIONS,
  sanitizeDisplayFilename,
  validateProofFile,
} from "~/domain/proofs/file-validation";
import { resolveProofRequestByToken } from "~/auth/proof-token.server";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";
import {
  PROOF_APPROVAL_ACKNOWLEDGEMENT_VERSION,
  PROOF_APPROVAL_MISSING_ACKNOWLEDGEMENT_MESSAGE,
} from "~/domain/proofs/labels";
import { syncOrderLifecycleTag } from "~/domain/orders/sync-order-lifecycle-tag.server";

export interface CustomerProofResponseFileInput {
  buffer: Buffer;
  originalFilename: string;
}

export interface RecordCustomerProofResponseInput {
  rawToken: string;
  proofGroupId: string;
  responseType: "APPROVED" | "CHANGES_REQUESTED";
  customerNote: string | null;
  changeCategories: ChangeRequestCategory[];
  /** Must be true for an APPROVED response — the deliberate confirmation checkbox, never inferred. */
  acknowledgedApproval: boolean;
  /** Client-generated once per submission attempt — a resubmission with the same key returns the existing response. */
  idempotencyKey: string;
  requestIp: string | null;
  requestUserAgent: string | null;
  files: CustomerProofResponseFileInput[];
}

export type RecordCustomerProofResponseResult =
  | { outcome: "recorded"; responseId: string }
  | { outcome: "duplicate"; responseId: string }
  | { outcome: "rejected"; reason: string };

// Thrown inside the transaction when a concurrent action (another response
// to the same group/version, or a staff member superseding it with a new
// version) won the race — caught and converted to a clean rejection, no
// response row created.
class AlreadyResolvedError extends Error {}

// Thrown when the unique idempotencyKey constraint catches a genuinely
// concurrent retry of THIS SAME submission (raced past the pre-check
// above) — distinct from AlreadyResolvedError: this one really is a
// duplicate of the caller's own request, not a different terminal event.
class ConcurrentDuplicateError extends Error {}

const GENERIC_LINK_INVALID_MESSAGE = "This proof link is no longer valid.";

export async function recordCustomerProofResponse(
  input: RecordCustomerProofResponseInput,
): Promise<RecordCustomerProofResponseResult> {
  const existingByKey = await db.customerProofResponse.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existingByKey) {
    return { outcome: "duplicate", responseId: existingByKey.id };
  }

  const resolved = await resolveProofRequestByToken(input.rawToken);
  if (resolved.outcome === "not_found") {
    return { outcome: "rejected", reason: GENERIC_LINK_INVALID_MESSAGE };
  }
  if (resolved.outcome === "revoked") {
    return { outcome: "rejected", reason: "This proof link has been revoked by Just Shear." };
  }
  if (resolved.outcome === "expired") {
    return { outcome: "rejected", reason: "This proof link has expired." };
  }
  const proofRequest = resolved.proofRequest;

  const requestGroup = await db.proofRequestGroup.findUnique({
    where: {
      proofRequestId_proofGroupId: {
        proofRequestId: proofRequest.id,
        proofGroupId: input.proofGroupId,
      },
    },
    include: { proofGroup: true, proofVersion: true },
  });
  if (!requestGroup) {
    return { outcome: "rejected", reason: "This proof group is not part of this request." };
  }
  if (
    requestGroup.proofVersion.status !== "SENT" &&
    requestGroup.proofVersion.status !== "VIEWED"
  ) {
    return {
      outcome: "rejected",
      reason:
        "This proof is no longer awaiting your response — it may already have been resolved, or a newer version may now be available.",
    };
  }

  if (input.responseType === "APPROVED" && !input.acknowledgedApproval) {
    return {
      outcome: "rejected",
      reason: PROOF_APPROVAL_MISSING_ACKNOWLEDGEMENT_MESSAGE,
    };
  }
  if (
    input.responseType === "CHANGES_REQUESTED" &&
    !input.customerNote?.trim() &&
    input.files.length === 0
  ) {
    return {
      outcome: "rejected",
      reason: "Please add feedback or upload a marked-up file describing the changes needed.",
    };
  }

  const responseId = randomUUID();
  const storedKeys: string[] = [];
  const assetData: {
    storageKey: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
  }[] = [];
  let newProofSummary: OrderProofSummary;

  try {
    for (const file of input.files) {
      const validation = validateProofFile(file.buffer);
      if (!validation.valid) {
        return {
          outcome: "rejected",
          reason: `One of your uploaded files couldn't be accepted: ${validation.reason}`,
        };
      }
      const storageKey = `customer-responses/${responseId}/${randomUUID()}.${PROOF_FILE_KIND_EXTENSIONS[validation.kind]}`;
      await storageAdapter.putObject({ key: storageKey, body: file.buffer });
      storedKeys.push(storageKey);
      assetData.push({
        storageKey,
        originalFilename: sanitizeDisplayFilename(file.originalFilename),
        mimeType: validation.mimeType,
        sizeBytes: file.buffer.length,
        checksum: createHash("sha256").update(file.buffer).digest("hex"),
      });
    }

    const group = requestGroup.proofGroup;
    const newStatus = input.responseType;

    newProofSummary = await db.$transaction(async (tx) => {
      const versionUpdate = await tx.proofVersion.updateMany({
        where: { id: requestGroup.proofVersionId, status: { in: ["SENT", "VIEWED"] } },
        data: {
          status: newStatus,
          respondedAt: new Date(),
          approvedAt: newStatus === "APPROVED" ? new Date() : null,
        },
      });
      if (versionUpdate.count === 0) {
        throw new AlreadyResolvedError();
      }

      try {
        await tx.customerProofResponse.create({
          data: {
            id: responseId,
            proofRequestId: proofRequest.id,
            proofVersionId: requestGroup.proofVersionId,
            responseType: input.responseType,
            customerNote: input.customerNote,
            changeCategories: input.changeCategories,
            requestIp: input.requestIp,
            requestUserAgent: input.requestUserAgent,
            idempotencyKey: input.idempotencyKey,
            acknowledgedVersion:
              input.responseType === "APPROVED" ? PROOF_APPROVAL_ACKNOWLEDGEMENT_VERSION : null,
            assets: { create: assetData },
          },
        });
      } catch (error) {
        // A genuinely concurrent duplicate (same idempotencyKey, both
        // requests racing past the pre-check above) — the unique
        // constraint is the real guard; the pre-check is just the common
        // fast path.
        if (isUniqueConstraintViolation(error)) {
          throw new ConcurrentDuplicateError();
        }
        throw error;
      }

      await tx.proofGroup.update({ where: { id: group.id }, data: { status: newStatus } });

      await tx.activityEvent.create({
        data: {
          shopId: proofRequest.shopId,
          orderId: proofRequest.orderId,
          entityType: "ProofGroup",
          entityId: group.id,
          eventType:
            newStatus === "APPROVED" ? "proof_group_approved" : "proof_group_changes_requested",
          summary:
            newStatus === "APPROVED"
              ? `Customer approved "${group.name}" (version ${requestGroup.proofVersion.versionNumber})`
              : `Customer requested changes to "${group.name}" (version ${requestGroup.proofVersion.versionNumber})`,
          metadata: {
            proofRequestId: proofRequest.id,
            proofVersionId: requestGroup.proofVersionId,
            responseId,
          },
          actorType: ActorType.CUSTOMER,
        },
      });

      if (newStatus === "CHANGES_REQUESTED" && group.assignedStaffId) {
        await tx.notification.create({
          data: {
            staffUserId: group.assignedStaffId,
            type: "proof_changes_requested",
            title: `Changes requested: ${group.name}`,
            body: input.customerNote,
            relatedEntityType: "ProofGroup",
            relatedEntityId: group.id,
          },
        });
      }

      const recalculatedSummary = await recalculateOrderProofSummary(tx, {
        shopId: proofRequest.shopId,
        orderId: proofRequest.orderId,
        actorStaffId: null,
      });

      // A request is complete only once every included group's response has
      // reached a terminal state for the exact version sent — APPROVED or
      // CHANGES_REQUESTED both count as "resolved" here; only an
      // unresolved SENT/VIEWED group keeps the request open.
      const allLinks = await tx.proofRequestGroup.findMany({
        where: { proofRequestId: proofRequest.id },
        include: { proofVersion: { select: { status: true } } },
      });
      const allResolved = allLinks.every(
        (link) =>
          link.proofVersion.status === "APPROVED" ||
          link.proofVersion.status === "CHANGES_REQUESTED",
      );
      const someResolved = allLinks.some(
        (link) =>
          link.proofVersion.status === "APPROVED" ||
          link.proofVersion.status === "CHANGES_REQUESTED",
      );
      if (allResolved) {
        await tx.proofRequest.updateMany({
          where: { id: proofRequest.id, status: { in: ["SENT", "VIEWED", "PARTIALLY_RESPONDED"] } },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      } else if (someResolved) {
        await tx.proofRequest.updateMany({
          where: { id: proofRequest.id, status: { in: ["SENT", "VIEWED"] } },
          data: { status: "PARTIALLY_RESPONDED" },
        });
      }

      return recalculatedSummary;
    });
  } catch (error) {
    // Best-effort cleanup only; the original transaction error is what matters.
    await Promise.all(
      storedKeys.map((key) =>
        storageAdapter.deleteObject(key).catch(() => {
          // Intentionally empty — see comment above.
        }),
      ),
    );
    if (error instanceof ConcurrentDuplicateError) {
      const existing = await db.customerProofResponse.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return { outcome: "duplicate", responseId: existing.id };
      }
      // Vanishingly unlikely (the row that caused the constraint violation
      // should be readable immediately after), but never surface a
      // rejection that implies nothing was recorded when something was.
      throw error;
    }
    if (error instanceof AlreadyResolvedError) {
      return {
        outcome: "rejected",
        reason:
          "This proof is no longer awaiting your response — it may already have been resolved, or a newer version may now be available.",
      };
    }
    throw error;
  }

  // Driven off the recalculated order-level aggregate, not the raw
  // per-call responseType — an order can have multiple proof groups, and
  // branching on the single group this call is about could flip the tag
  // backwards depending on which group happens to respond last. Any other
  // aggregate (still waiting on other groups, etc.) leaves the tag alone —
  // "proof_sent" stays accurate.
  try {
    if (newProofSummary === "CHANGES_REQUESTED") {
      await syncOrderLifecycleTag({
        shopId: proofRequest.shopId,
        orderId: proofRequest.orderId,
        addTag: "proof_rejected",
        removeTags: ["proof_sent", "proof_accepted"],
      });
    } else if (
      newProofSummary === "PARTIALLY_APPROVED" ||
      newProofSummary === "ALL_REQUIRED_PROOFS_APPROVED"
    ) {
      await syncOrderLifecycleTag({
        shopId: proofRequest.shopId,
        orderId: proofRequest.orderId,
        addTag: "proof_accepted",
        removeTags: ["proof_sent", "proof_rejected"],
      });
    }
  } catch {
    // Defensive backstop only — see send-proof-request.server.ts's
    // identical comment on its own syncOrderLifecycleTag call.
  }

  return { outcome: "recorded", responseId };
}
