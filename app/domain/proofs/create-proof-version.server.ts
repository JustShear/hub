import { createHash, randomUUID } from "node:crypto";
import { imageSize } from "image-size";
import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";
import { localDiskStorageAdapter } from "~/adapters/storage/local-disk-storage.server";
import {
  PROOF_FILE_KIND_EXTENSIONS,
  sanitizeDisplayFilename,
  validateProofFile,
} from "~/domain/proofs/file-validation";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";

const MAX_VERSION_NUMBER_ATTEMPTS = 5;

export interface CreateProofVersionInput {
  shopId: string;
  proofGroupId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  internalNote: string | null;
  sourceAssetIds: string[];
  /** Client-generated once per upload attempt — a retry with the same key returns the already-created version. */
  idempotencyKey: string | null;
  staffUserId: string;
}

export type CreateProofVersionResult =
  | { outcome: "created"; proofVersionId: string; versionNumber: number }
  | { outcome: "duplicate"; proofVersionId: string; versionNumber: number }
  | { outcome: "rejected"; reason: string };

export async function createProofVersion(
  input: CreateProofVersionInput,
): Promise<CreateProofVersionResult> {
  const group = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
  });
  if (!group) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }
  if (group.status === "CANCELLED") {
    return { outcome: "rejected", reason: "This proof group is cancelled." };
  }
  if (group.status === "NO_PROOF_REQUIRED") {
    return {
      outcome: "rejected",
      reason:
        "This group is marked no proof required — change the requirement decision before creating a proof version.",
    };
  }

  if (input.idempotencyKey) {
    const existing = await db.proofVersion.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return {
        outcome: "duplicate",
        proofVersionId: existing.id,
        versionNumber: existing.versionNumber,
      };
    }
  }

  if (input.sourceAssetIds.length > 0) {
    const validAssetCount = await db.customerArtworkAsset.count({
      where: { id: { in: input.sourceAssetIds }, shopId: input.shopId },
    });
    if (validAssetCount !== input.sourceAssetIds.length) {
      return {
        outcome: "rejected",
        reason: "One or more selected source assets don't belong to this shop.",
      };
    }
  }

  const validation = validateProofFile(input.fileBuffer);
  if (!validation.valid) {
    return { outcome: "rejected", reason: validation.reason };
  }

  const checksum = createHash("sha256").update(input.fileBuffer).digest("hex");
  let width: number | null = null;
  let height: number | null = null;
  if (validation.kind === "png" || validation.kind === "jpeg") {
    try {
      const dimensions = imageSize(input.fileBuffer);
      width = dimensions.width;
      height = dimensions.height;
    } catch {
      // Leave width/height null rather than guess — an honest "unknown", not a failure.
    }
  }

  // Random, server-generated key — never derived from the original filename
  // or any user input, so path traversal isn't reachable.
  const storageKey = `proof-versions/${input.proofGroupId}/${randomUUID()}.${PROOF_FILE_KIND_EXTENSIONS[validation.kind]}`;
  await localDiskStorageAdapter.putObject({ key: storageKey, body: input.fileBuffer });

  try {
    const created = await createVersionWithRetry({
      proofGroupId: input.proofGroupId,
      shopId: input.shopId,
      orderId: group.orderId,
      groupName: group.name,
      internalNote: input.internalNote,
      idempotencyKey: input.idempotencyKey,
      staffUserId: input.staffUserId,
      storageKey,
      originalFilename: sanitizeDisplayFilename(input.originalFilename),
      mimeType: validation.mimeType,
      sizeBytes: input.fileBuffer.length,
      checksum,
      width,
      height,
      sourceAssetIds: input.sourceAssetIds,
    });
    return { outcome: "created", proofVersionId: created.id, versionNumber: created.versionNumber };
  } catch (error) {
    // The DB side failed after the file was already written to storage —
    // clean up the orphaned object rather than leaving it unreferenced.
    await localDiskStorageAdapter.deleteObject(storageKey).catch(() => {
      // Best-effort cleanup only; the original DB error is what matters.
    });
    throw error;
  }
}

interface CreateVersionWithRetryParams {
  proofGroupId: string;
  shopId: string;
  orderId: string;
  groupName: string;
  internalNote: string | null;
  idempotencyKey: string | null;
  staffUserId: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  width: number | null;
  height: number | null;
  sourceAssetIds: string[];
}

// The @@unique([proofGroupId, versionNumber]) constraint is the real
// concurrency guard: two simultaneous requests can both read the same
// "latest" version and both attempt the next number, but only one INSERT
// can win — the loser retries with a freshly-read number instead of
// surfacing a false error to the caller.
async function createVersionWithRetry(
  params: CreateVersionWithRetryParams,
): Promise<{ id: string; versionNumber: number }> {
  for (let attempt = 0; attempt < MAX_VERSION_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const latest = await tx.proofVersion.findFirst({
          where: { proofGroupId: params.proofGroupId },
          orderBy: { versionNumber: "desc" },
        });
        const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

        const created = await tx.proofVersion.create({
          data: {
            proofGroupId: params.proofGroupId,
            versionNumber: nextVersionNumber,
            status: "DRAFT",
            internalNote: params.internalNote,
            createdByStaffId: params.staffUserId,
            idempotencyKey: params.idempotencyKey,
          },
        });

        await tx.proofAsset.create({
          data: {
            proofVersionId: created.id,
            storageKey: params.storageKey,
            isPrimary: true,
            sortOrder: 0,
            originalFilename: params.originalFilename,
            mimeType: params.mimeType,
            sizeBytes: params.sizeBytes,
            checksum: params.checksum,
            width: params.width,
            height: params.height,
            uploadedByStaffId: params.staffUserId,
          },
        });

        if (params.sourceAssetIds.length > 0) {
          await tx.proofVersionSourceAsset.createMany({
            data: params.sourceAssetIds.map((assetId) => ({ proofVersionId: created.id, assetId })),
          });
        }

        // Never silently supersede an APPROVED version — moot this
        // milestone (APPROVED is structurally unreachable), but documents
        // the rule for when it becomes reachable.
        if (latest && (latest.status === "DRAFT" || latest.status === "READY_TO_SEND")) {
          await tx.proofVersion.update({
            where: { id: latest.id },
            data: {
              status: "SUPERSEDED",
              supersededByVersionId: created.id,
              supersededAt: new Date(),
            },
          });
          await tx.activityEvent.create({
            data: {
              shopId: params.shopId,
              orderId: params.orderId,
              entityType: "ProofVersion",
              entityId: latest.id,
              eventType: "proof_version_superseded",
              summary: `Proof version ${latest.versionNumber} superseded by version ${nextVersionNumber}`,
              metadata: { supersededByVersionId: created.id },
              actorStaffId: params.staffUserId,
              actorType: ActorType.STAFF,
            },
          });
        }

        await tx.proofGroup.update({
          where: { id: params.proofGroupId },
          data: { status: "DRAFT_IN_PROGRESS" },
        });

        await tx.activityEvent.create({
          data: {
            shopId: params.shopId,
            orderId: params.orderId,
            entityType: "ProofGroup",
            entityId: params.proofGroupId,
            eventType: "proof_version_created",
            summary: `Proof version ${nextVersionNumber} created for "${params.groupName}"`,
            metadata: { proofVersionId: created.id, versionNumber: nextVersionNumber },
            actorStaffId: params.staffUserId,
            actorType: ActorType.STAFF,
          },
        });
        await tx.activityEvent.create({
          data: {
            shopId: params.shopId,
            orderId: params.orderId,
            entityType: "ProofVersion",
            entityId: created.id,
            eventType: "proof_file_uploaded",
            summary: `Proof file "${params.originalFilename}" uploaded to version ${nextVersionNumber}`,
            metadata: { mimeType: params.mimeType, sizeBytes: params.sizeBytes },
            actorStaffId: params.staffUserId,
            actorType: ActorType.STAFF,
          },
        });

        await recalculateOrderProofSummary(tx, {
          shopId: params.shopId,
          orderId: params.orderId,
          actorStaffId: params.staffUserId,
        });

        return { id: created.id, versionNumber: created.versionNumber };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error) && attempt < MAX_VERSION_NUMBER_ATTEMPTS - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to allocate a proof version number after multiple attempts.");
}
