import { createHash, randomUUID } from "node:crypto";
import { ActorType, Prisma, type DecorationMethod, type NoProofReason } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";
import {
  PRODUCTION_ARTWORK_KIND_EXTENSIONS,
  sanitizeDisplayFilename,
  validateProductionArtworkFile,
} from "~/domain/production/file-validation";
import {
  evaluateProductionArtworkEligibility,
  validateProductionArtworkMetadata,
} from "~/domain/production/eligibility";

const MAX_REVISION_NUMBER_ATTEMPTS = 5;

export interface CreateProductionArtworkInput {
  shopId: string;
  proofGroupId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  /** Defaults to the proof group's own decorationMethod when not supplied. */
  decorationMethod: DecorationMethod | null;
  placement: string | null;
  productionMetadata: Record<string, unknown> | null;
  staffUserId: string;
  /** Client-generated once per upload attempt — a retry with the same key returns the already-created revision. */
  idempotencyKey: string | null;
}

export type CreateProductionArtworkResult =
  | { outcome: "created"; productionArtworkId: string; revisionNumber: number }
  | { outcome: "duplicate"; productionArtworkId: string; revisionNumber: number }
  | { outcome: "rejected"; reason: string; issues?: string[] };

export async function createProductionArtwork(
  input: CreateProductionArtworkInput,
): Promise<CreateProductionArtworkResult> {
  const group = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
    include: { order: { select: { id: true, workflowStatus: true } } },
  });
  if (!group) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }

  const currentVersion = await db.proofVersion.findFirst({
    where: { proofGroupId: input.proofGroupId, status: { notIn: ["SUPERSEDED", "CANCELLED"] } },
    orderBy: { versionNumber: "desc" },
    select: { id: true, status: true },
  });

  const eligibility = evaluateProductionArtworkEligibility({
    orderStatus: group.order.workflowStatus,
    proofGroupStatus: group.status,
    noProofReason: group.noProofReason,
    currentVersion,
  });
  if (!eligibility.eligible) {
    return {
      outcome: "rejected",
      reason: "This proof group isn't eligible for production artwork yet.",
      issues: eligibility.reasons,
    };
  }

  const declaredExtension = input.originalFilename.split(".").pop() ?? "";
  const validation = validateProductionArtworkFile(input.fileBuffer, declaredExtension);
  if (!validation.valid) {
    return { outcome: "rejected", reason: validation.reason };
  }

  const checksum = createHash("sha256").update(input.fileBuffer).digest("hex");

  // Pre-storage-write idempotency check: an identical resubmission (same
  // group, same content) returns the existing revision rather than writing
  // a duplicate file to storage.
  if (input.idempotencyKey) {
    const existingByChecksum = await db.productionArtwork.findFirst({
      where: { proofGroupId: input.proofGroupId, checksum, status: { not: "CANCELLED" } },
      orderBy: { revisionNumber: "desc" },
    });
    if (existingByChecksum) {
      return {
        outcome: "duplicate",
        productionArtworkId: existingByChecksum.id,
        revisionNumber: existingByChecksum.revisionNumber,
      };
    }
  }

  const storageKey = `production-artwork/${input.proofGroupId}/${randomUUID()}.${PRODUCTION_ARTWORK_KIND_EXTENSIONS[validation.kind]}`;
  await storageAdapter.putObject({ key: storageKey, body: input.fileBuffer });

  const resolvedDecorationMethod = input.decorationMethod ?? group.decorationMethod;
  const validationResult = validateProductionArtworkMetadata({
    decorationMethod: resolvedDecorationMethod,
    placement: input.placement,
  });

  try {
    const created = await createArtworkRevisionWithRetry({
      shopId: input.shopId,
      orderId: group.orderId,
      proofGroupId: input.proofGroupId,
      groupName: group.name,
      sourceProofVersionId:
        eligibility.path === "approved_version" ? (currentVersion?.id ?? null) : null,
      sourceNoProofReasonSnapshot:
        eligibility.path === "no_proof_required" ? group.noProofReason : null,
      decorationMethod: resolvedDecorationMethod,
      placement: input.placement,
      productionMetadata: input.productionMetadata,
      validationStatus: validationResult.passed,
      validationMessages: validationResult.messages,
      storageKey,
      originalFilename: sanitizeDisplayFilename(input.originalFilename),
      mimeType: validation.mimeType,
      sizeBytes: input.fileBuffer.length,
      checksum,
      isPreviewable: validation.isPreviewable,
      staffUserId: input.staffUserId,
    });
    return {
      outcome: "created",
      productionArtworkId: created.id,
      revisionNumber: created.revisionNumber,
    };
  } catch (error) {
    await storageAdapter.deleteObject(storageKey).catch(() => {
      // Best-effort cleanup only; the original DB error is what matters.
    });
    throw error;
  }
}

interface CreateArtworkRevisionParams {
  shopId: string;
  orderId: string;
  proofGroupId: string;
  groupName: string;
  sourceProofVersionId: string | null;
  sourceNoProofReasonSnapshot: NoProofReason | null;
  decorationMethod: DecorationMethod;
  placement: string | null;
  productionMetadata: Record<string, unknown> | null;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  isPreviewable: boolean;
  validationStatus: boolean;
  validationMessages: string[];
  staffUserId: string;
}

// The @@unique([proofGroupId, revisionNumber]) constraint is the real
// concurrency guard, exactly matching createVersionWithRetry's pattern in
// app/domain/proofs/create-proof-version.server.ts.
async function createArtworkRevisionWithRetry(
  params: CreateArtworkRevisionParams,
): Promise<{ id: string; revisionNumber: number }> {
  for (let attempt = 0; attempt < MAX_REVISION_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const latest = await tx.productionArtwork.findFirst({
          where: { proofGroupId: params.proofGroupId },
          orderBy: { revisionNumber: "desc" },
        });
        const nextRevisionNumber = (latest?.revisionNumber ?? 0) + 1;

        const created = await tx.productionArtwork.create({
          data: {
            shopId: params.shopId,
            proofGroupId: params.proofGroupId,
            sourceProofVersionId: params.sourceProofVersionId,
            sourceNoProofReasonSnapshot: params.sourceNoProofReasonSnapshot,
            revisionNumber: nextRevisionNumber,
            status: params.validationStatus ? "DRAFT" : "VALIDATION_FAILED",
            storageKey: params.storageKey,
            originalFilename: params.originalFilename,
            mimeType: params.mimeType,
            sizeBytes: params.sizeBytes,
            checksum: params.checksum,
            isPreviewable: params.isPreviewable,
            decorationMethod: params.decorationMethod,
            placement: params.placement,
            productionMetadata: params.productionMetadata
              ? (params.productionMetadata as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            validationStatus: params.validationStatus,
            validationMessages: params.validationMessages,
            createdByStaffId: params.staffUserId,
          },
        });

        // A prior non-terminal revision (DRAFT/VALIDATION_FAILED/
        // READY_FOR_EXPORT — never EXPORTED, which is immutable history) is
        // superseded, never overwritten or deleted.
        const supersedableStatuses = ["DRAFT", "VALIDATION_FAILED", "READY_FOR_EXPORT"];
        if (latest && supersedableStatuses.includes(latest.status)) {
          await tx.productionArtwork.update({
            where: { id: latest.id },
            data: {
              status: "SUPERSEDED",
              supersededByArtworkId: created.id,
              supersededAt: new Date(),
            },
          });
          await tx.activityEvent.create({
            data: {
              shopId: params.shopId,
              orderId: params.orderId,
              entityType: "ProductionArtwork",
              entityId: latest.id,
              eventType: "production_artwork_superseded",
              summary: `Production artwork revision ${latest.revisionNumber} superseded by revision ${nextRevisionNumber}`,
              metadata: { supersededByArtworkId: created.id, previousStatus: latest.status },
              actorStaffId: params.staffUserId,
              actorType: ActorType.STAFF,
            },
          });
        }

        // Carry forward the previous revision's order-line allocations onto
        // the new one — a correction to the artwork file doesn't usually
        // change which lines it covers, and staff can adjust afterwards.
        if (latest) {
          const priorAllocations = await tx.productionArtworkOrderLine.findMany({
            where: { productionArtworkId: latest.id },
          });
          if (priorAllocations.length > 0) {
            await tx.productionArtworkOrderLine.createMany({
              data: priorAllocations.map((a) => ({
                productionArtworkId: created.id,
                orderLineId: a.orderLineId,
                quantity: a.quantity,
              })),
            });
          }
        }

        await tx.activityEvent.create({
          data: {
            shopId: params.shopId,
            orderId: params.orderId,
            entityType: "ProofGroup",
            entityId: params.proofGroupId,
            eventType: "production_artwork_created",
            summary: `Production artwork revision ${nextRevisionNumber} created for "${params.groupName}"`,
            metadata: { productionArtworkId: created.id, revisionNumber: nextRevisionNumber },
            actorStaffId: params.staffUserId,
            actorType: ActorType.STAFF,
          },
        });

        return { id: created.id, revisionNumber: created.revisionNumber };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error) && attempt < MAX_REVISION_NUMBER_ATTEMPTS - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    "Failed to allocate a production artwork revision number after multiple attempts.",
  );
}
