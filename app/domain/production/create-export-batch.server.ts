import { randomUUID } from "node:crypto";
import { ActorType, Prisma, type OrderStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";
import { isSpecialStatus } from "~/domain/orders/board-columns";
import { evaluateExportBatchItemEligibility } from "~/domain/production/eligibility";
import {
  buildArchiveFilename,
  buildExportManifest,
  type ExportManifestItemInput,
} from "~/domain/production/export-manifest";
import { buildExportPackage } from "~/domain/production/export-package.server";
import { createProductionJobsFromExportBatch } from "~/domain/production/create-production-jobs.server";
import { recalculateOrderProofSummary } from "~/domain/proofs/order-proof-summary.server";
import { syncOrderLifecycleTag } from "~/domain/orders/sync-order-lifecycle-tag.server";

const MAX_BATCH_NUMBER_ATTEMPTS = 5;

export interface CreateExportBatchInput {
  shopId: string;
  orderId: string;
  proofGroupIds: string[];
  destination: string | null;
  staffUserId: string;
  /** Client-generated once per export attempt — a retry with the same key returns the already-created batch. */
  idempotencyKey: string;
  /**
   * Non-null marks this a re-export: a reason is mandatory, and the new
   * batch records a `previousBatchId` link to the order's most recent
   * export batch rather than starting a fresh, unrelated chain.
   */
  reexportReason?: string | null;
}

export type CreateExportBatchResult =
  | { outcome: "exported"; exportBatchId: string; batchNumber: number }
  | { outcome: "duplicate"; exportBatchId: string; batchNumber: number }
  | { outcome: "rejected"; reason: string; issues?: string[] };

type ExportItemInput = ExportManifestItemInput & {
  proofGroupId: string;
  productionArtworkStorageKey: string;
};

export async function createExportBatch(
  input: CreateExportBatchInput,
): Promise<CreateExportBatchResult> {
  if (input.proofGroupIds.length === 0) {
    return { outcome: "rejected", reason: "Select at least one proof group to export." };
  }
  if (
    input.reexportReason !== undefined &&
    input.reexportReason !== null &&
    !input.reexportReason.trim()
  ) {
    return { outcome: "rejected", reason: "A reason is required to re-export." };
  }

  const existingByKey = await db.exportBatch.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existingByKey) {
    return {
      outcome: "duplicate",
      exportBatchId: existingByKey.id,
      batchNumber: existingByKey.batchNumber,
    };
  }

  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    include: { shop: { select: { shopifyDomain: true } } },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  const staffUser = await db.staffUser.findUnique({
    where: { id: input.staffUserId },
    select: { name: true },
  });
  if (!staffUser) {
    return { outcome: "rejected", reason: "Staff user not found." };
  }

  const { items, issues } = await loadExportItems(
    input.orderId,
    input.proofGroupIds,
    order.workflowStatus,
  );
  if (issues.length > 0) {
    return {
      outcome: "rejected",
      reason: "One or more selected proof groups aren't ready for export.",
      issues,
    };
  }

  // Phase 1: reserve the batch number and idempotency key up front, in
  // PREPARING status, before any file I/O happens — this is what makes a
  // failed attempt (see phase 3) a permanent, visible audit record instead
  // of a silently discarded number.
  const isReexport = Boolean(input.reexportReason);
  const previousBatch = isReexport
    ? await db.exportBatch.findFirst({
        where: { orderId: input.orderId, status: "EXPORTED" },
        orderBy: { batchNumber: "desc" },
      })
    : null;

  const reserved = await reserveExportBatch({
    shopId: input.shopId,
    orderId: input.orderId,
    destination: input.destination,
    idempotencyKey: input.idempotencyKey,
    staffUserId: input.staffUserId,
    previousBatchId: previousBatch?.id ?? null,
    reexportReason: input.reexportReason ?? null,
  });

  // Phase 2: build the manifest (now that the real batch number is known)
  // and the ZIP package — I/O only, no DB transaction held open for it.
  const exportedAt = new Date();
  const manifest = buildExportManifest({
    shopName: order.shop.shopifyDomain,
    orderNumber: order.orderNumber,
    orderId: order.id,
    batchNumber: reserved.batchNumber,
    exportedAt,
    exportedByStaffName: staffUser.name,
    isReexport,
    reexportReason: input.reexportReason ?? null,
    items,
  });

  let packageBuffer: Buffer;
  let packageChecksum: string;
  try {
    const built = await buildExportPackage(
      manifest,
      items.map((item) => ({
        storageKey: item.productionArtworkStorageKey,
        archiveFilename: item.archiveFilename,
      })),
    );
    packageBuffer = built.buffer;
    packageChecksum = built.checksum;
  } catch (error) {
    await failExportBatch(reserved.id, `Failed to build the export package: ${String(error)}`);
    throw error;
  }

  const packageStorageKey = `export-batches/${input.orderId}/${randomUUID()}.zip`;
  await storageAdapter.putObject({ key: packageStorageKey, body: packageBuffer });

  // Phase 3: the atomic finalisation transaction — re-verifies every item's
  // eligibility right now (a concurrent cancellation/reopen could have
  // landed since phase 1) via CAS updateMany count checks, and only then
  // flips artwork/group status and writes the batch's final state.
  try {
    const finalized = await finalizeExportBatch({
      exportBatchId: reserved.id,
      batchNumber: reserved.batchNumber,
      shopId: input.shopId,
      orderId: input.orderId,
      staffUserId: input.staffUserId,
      exportedAt,
      packageStorageKey,
      packageChecksum,
      manifest,
      items,
    });
    if (!finalized.applied) {
      await storageAdapter.deleteObject(packageStorageKey).catch(() => {
        // Best-effort cleanup only.
      });
      return {
        outcome: "rejected",
        reason:
          "One or more selected proof groups changed state while the export was being prepared — the attempt was recorded as failed. Please review and try again.",
      };
    }

    // Automatic follow-up, deliberately outside the export's own success —
    // the export has already genuinely happened; a failure creating
    // production jobs from it must never be reported back as an export
    // failure. Idempotent and independently re-triggerable (see
    // create-production-jobs.server.ts), so this is a safe best-effort call.
    try {
      await createProductionJobsFromExportBatch({
        shopId: input.shopId,
        exportBatchId: reserved.id,
        staffUserId: input.staffUserId,
      });
    } catch {
      // Swallowed deliberately — the order simply stays READY_FOR_PRODUCTION
      // until a staff member (or a retry of this same call) creates the
      // jobs; see production_jobs.create.
    }

    try {
      // Add-only, deliberately — the shop wants prior lifecycle tags left
      // on the order in Shopify; this column's match priority already
      // outranks proof_sent/rejected/accepted, so leaving them doesn't
      // affect board placement. See board-columns.ts's identical note on
      // the manual-drag path for the same tag.
      await syncOrderLifecycleTag({
        shopId: input.shopId,
        orderId: input.orderId,
        addTag: "Exported for Print",
        removeTags: [],
      });
    } catch {
      // Defensive backstop only — see send-proof-request.server.ts's
      // identical comment on its own syncOrderLifecycleTag call.
    }

    return { outcome: "exported", exportBatchId: reserved.id, batchNumber: reserved.batchNumber };
  } catch (error) {
    await storageAdapter.deleteObject(packageStorageKey).catch(() => {
      // Best-effort cleanup only.
    });
    await failExportBatch(reserved.id, `Unexpected error finalising the export: ${String(error)}`);
    throw error;
  }
}

export interface ReExportBatchInput {
  shopId: string;
  orderId: string;
  proofGroupIds: string[];
  destination: string | null;
  staffUserId: string;
  idempotencyKey: string;
  /** Mandatory — re-exporting is always a deliberate, reasoned action. */
  reexportReason: string;
}

/**
 * Re-export is deliberately not just "call createExportBatch again" from
 * the caller's perspective — this wrapper makes the reason a required
 * field at the type level, not just an internal runtime check.
 */
export async function reExportBatch(input: ReExportBatchInput): Promise<CreateExportBatchResult> {
  if (!input.reexportReason.trim()) {
    return { outcome: "rejected", reason: "A reason is required to re-export." };
  }
  return createExportBatch(input);
}

async function loadExportItems(
  orderId: string,
  proofGroupIds: string[],
  orderStatus: OrderStatus,
): Promise<{ items: ExportItemInput[]; issues: string[] }> {
  const groups = await db.proofGroup.findMany({
    where: { id: { in: proofGroupIds }, orderId },
    include: {
      productionArtworks: { where: { status: "READY_FOR_EXPORT" } },
      orderLines: { include: { orderLine: true } },
    },
  });
  if (groups.length !== proofGroupIds.length) {
    return {
      items: [],
      issues: ["One or more selected proof groups don't belong to this order."],
    };
  }

  const issues: string[] = [];
  const items: ExportItemInput[] = [];

  for (const group of groups) {
    const artwork = group.productionArtworks[0];

    let sourceVersionStillApproved: boolean | null = null;
    let sourceVersionNumber: number | null = null;
    if (artwork?.sourceProofVersionId) {
      const sourceVersion = await db.proofVersion.findUnique({
        where: { id: artwork.sourceProofVersionId },
        select: { status: true, versionNumber: true },
      });
      sourceVersionStillApproved = sourceVersion?.status === "APPROVED";
      sourceVersionNumber = sourceVersion?.versionNumber ?? null;
    }

    const eligibility = evaluateExportBatchItemEligibility({
      orderStatus,
      proofGroupStatus: group.status,
      artworkStatus: artwork?.status ?? "CANCELLED",
      sourceVersionStillApproved,
    });
    if (!eligibility.eligible || !artwork) {
      issues.push(`"${group.name}": ${eligibility.reasons.join(" ")}`);
      continue;
    }

    items.push({
      proofGroupId: group.id,
      proofGroupName: group.name,
      decorationMethod: artwork.decorationMethod,
      placement: artwork.placement,
      approximateWidthMm: group.approximateWidthMm,
      approximateHeightMm: group.approximateHeightMm,
      sourceProofVersionNumber: sourceVersionNumber,
      sourceNoProofReason: artwork.sourceNoProofReasonSnapshot,
      productionArtworkId: artwork.id,
      productionArtworkRevisionNumber: artwork.revisionNumber,
      originalFilename: artwork.originalFilename,
      archiveFilename: buildArchiveFilename({
        proofGroupName: group.name,
        revisionNumber: artwork.revisionNumber,
        originalFilename: artwork.originalFilename,
      }),
      mimeType: artwork.mimeType,
      sizeBytes: artwork.sizeBytes,
      checksum: artwork.checksum,
      productionArtworkStorageKey: artwork.storageKey,
      orderLineAllocations: group.orderLines.map((link) => ({
        productLabel: link.orderLine.variantTitle
          ? `${link.orderLine.productTitle} - ${link.orderLine.variantTitle}`
          : link.orderLine.productTitle,
        quantity: link.quantity,
      })),
    });
  }

  return { items, issues };
}

interface ReserveParams {
  shopId: string;
  orderId: string;
  destination: string | null;
  idempotencyKey: string;
  staffUserId: string;
  previousBatchId: string | null;
  reexportReason: string | null;
}

// The @@unique([orderId, batchNumber]) constraint is the real concurrency
// guard, mirroring createVersionWithRetry/createArtworkRevisionWithRetry.
async function reserveExportBatch(
  params: ReserveParams,
): Promise<{ id: string; batchNumber: number }> {
  for (let attempt = 0; attempt < MAX_BATCH_NUMBER_ATTEMPTS; attempt++) {
    try {
      const latest = await db.exportBatch.findFirst({
        where: { orderId: params.orderId },
        orderBy: { batchNumber: "desc" },
      });
      const nextBatchNumber = (latest?.batchNumber ?? 0) + 1;
      const created = await db.exportBatch.create({
        data: {
          shopId: params.shopId,
          orderId: params.orderId,
          batchNumber: nextBatchNumber,
          status: "PREPARING",
          idempotencyKey: params.idempotencyKey,
          createdByStaffId: params.staffUserId,
          destination: params.destination,
          previousBatchId: params.previousBatchId,
          reexportReason: params.reexportReason,
        },
      });
      return { id: created.id, batchNumber: created.batchNumber };
    } catch (error) {
      if (isUniqueConstraintViolation(error) && attempt < MAX_BATCH_NUMBER_ATTEMPTS - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to allocate an export batch number after multiple attempts.");
}

async function failExportBatch(exportBatchId: string, reason: string): Promise<void> {
  await db.exportBatch.updateMany({
    where: { id: exportBatchId, status: "PREPARING" },
    data: { status: "FAILED", cancelReason: reason },
  });
}

interface FinalizeParams {
  exportBatchId: string;
  batchNumber: number;
  shopId: string;
  orderId: string;
  staffUserId: string;
  exportedAt: Date;
  packageStorageKey: string;
  packageChecksum: string;
  manifest: ReturnType<typeof buildExportManifest>;
  items: ExportItemInput[];
}

async function finalizeExportBatch(params: FinalizeParams): Promise<{ applied: boolean }> {
  return db.$transaction(async (tx) => {
    for (const item of params.items) {
      const artworkUpdate = await tx.productionArtwork.updateMany({
        where: { id: item.productionArtworkId, status: "READY_FOR_EXPORT" },
        data: { status: "EXPORTED" },
      });
      if (artworkUpdate.count === 0) {
        await tx.exportBatch.updateMany({
          where: { id: params.exportBatchId, status: "PREPARING" },
          data: {
            status: "FAILED",
            cancelReason: `Proof group "${item.proofGroupName}" was no longer ready for export when the batch was finalised.`,
          },
        });
        return { applied: false };
      }
      const groupUpdate = await tx.proofGroup.updateMany({
        where: {
          id: item.proofGroupId,
          status: { in: ["READY_FOR_EXPORT", "APPROVED", "NO_PROOF_REQUIRED"] },
        },
        data: { status: "EXPORTED_FOR_PRINT" },
      });
      if (groupUpdate.count === 0) {
        await tx.exportBatch.updateMany({
          where: { id: params.exportBatchId, status: "PREPARING" },
          data: {
            status: "FAILED",
            cancelReason: `Proof group "${item.proofGroupName}" changed state when the batch was finalised.`,
          },
        });
        return { applied: false };
      }
    }

    const updateResult = await tx.exportBatch.updateMany({
      where: { id: params.exportBatchId, status: "PREPARING" },
      data: {
        status: "EXPORTED",
        exportedAt: params.exportedAt,
        manifestSnapshot: params.manifest as unknown as Prisma.InputJsonValue,
        packageStorageKey: params.packageStorageKey,
        packageChecksum: params.packageChecksum,
      },
    });
    if (updateResult.count === 0) {
      return { applied: false };
    }

    await tx.exportBatchItem.createMany({
      data: params.items.map((item) => ({
        exportBatchId: params.exportBatchId,
        proofGroupId: item.proofGroupId,
        productionArtworkId: item.productionArtworkId,
        sourceProofVersionId: null,
        sourceProofVersionNumber: item.sourceProofVersionNumber,
        sourceNoProofReasonSnapshot: item.sourceNoProofReason,
        decorationMethodSnapshot: item.decorationMethod,
        placementSnapshot: item.placement,
      })),
    });

    await tx.activityEvent.create({
      data: {
        shopId: params.shopId,
        orderId: params.orderId,
        entityType: "ExportBatch",
        entityId: params.exportBatchId,
        eventType: "export_batch_exported",
        summary: `Export batch ${params.batchNumber} created (${params.items.length} proof group${params.items.length === 1 ? "" : "s"})`,
        metadata: {
          batchNumber: params.batchNumber,
          proofGroupIds: params.items.map((i) => i.proofGroupId),
        },
        actorStaffId: params.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    for (const item of params.items) {
      await tx.activityEvent.create({
        data: {
          shopId: params.shopId,
          orderId: params.orderId,
          entityType: "ProofGroup",
          entityId: item.proofGroupId,
          eventType: "proof_group_exported_for_print",
          summary: `"${item.proofGroupName}" exported for print (batch ${params.batchNumber})`,
          metadata: {
            exportBatchId: params.exportBatchId,
            productionArtworkId: item.productionArtworkId,
          },
          actorStaffId: params.staffUserId,
          actorType: ActorType.STAFF,
        },
      });
    }

    await recalculateOrderProofSummary(tx, {
      shopId: params.shopId,
      orderId: params.orderId,
      actorStaffId: params.staffUserId,
    });
    await advanceOrderWorkflowStatusForExport(tx, params.orderId);

    return { applied: true };
  });
}

// Order-level export readiness is derived, never hand-set: this is the one
// place ShopifyOrder.workflowStatus moves into PARTIALLY_EXPORTED/
// EXPORTED_FOR_PRINT, and it only ever does so as a direct consequence of a
// real export just having happened inside this same transaction.
async function advanceOrderWorkflowStatusForExport(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const order = await tx.shopifyOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { workflowStatus: true },
  });
  if (isSpecialStatus(order.workflowStatus)) return;

  const groups = await tx.proofGroup.findMany({
    where: { orderId, status: { not: "CANCELLED" } },
    select: { status: true },
  });
  if (groups.length === 0) return;

  const allExported = groups.every((g) => g.status === "EXPORTED_FOR_PRINT");
  const someExported = groups.some((g) => g.status === "EXPORTED_FOR_PRINT");

  const target = allExported ? "EXPORTED_FOR_PRINT" : someExported ? "PARTIALLY_EXPORTED" : null;
  if (!target || order.workflowStatus === target) return;

  await tx.shopifyOrder.update({
    where: { id: orderId },
    data: { workflowStatus: target, workflowStatusChangedAt: new Date() },
  });
}
