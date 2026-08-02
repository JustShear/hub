import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProductionArtwork } from "~/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "~/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "~/domain/production/mark-production-artwork-ready.server";
import { createExportBatch, reExportBatch } from "~/domain/production/create-export-batch.server";
import { recordExportPackageDownload } from "~/domain/production/record-export-package-download.server";
import { localDiskStorageAdapter } from "~/adapters/storage/local-disk-storage.server";
import { createProductionTestTracker, PDF_BYTES } from "./helpers";

async function seedReadyToExportGroup(tracker: ReturnType<typeof createProductionTestTracker>) {
  const order = await tracker.createOrder();
  const staffUser = await tracker.createStaffUser();
  const line = await tracker.createOrderLine(order.id);
  const approved = await tracker.createApprovedGroup({
    orderId: order.id,
    shopId: order.shopId,
    staffUserId: staffUser.id,
    orderLineId: line.id,
  });
  const artwork = await createProductionArtwork({
    shopId: order.shopId,
    proofGroupId: approved.proofGroupId,
    fileBuffer: PDF_BYTES,
    originalFilename: "artwork.pdf",
    decorationMethod: null,
    placement: "Left chest",
    productionMetadata: null,
    staffUserId: staffUser.id,
    idempotencyKey: null,
  });
  if (artwork.outcome !== "created") throw new Error("setup failed");
  const allocation = await setProductionArtworkOrderLines({
    shopId: order.shopId,
    productionArtworkId: artwork.productionArtworkId,
    allocations: [{ orderLineId: line.id, quantity: line.quantity }],
    staffUserId: staffUser.id,
  });
  if (allocation.outcome !== "set") throw new Error("setup failed");
  const ready = await markProductionArtworkReady({
    shopId: order.shopId,
    productionArtworkId: artwork.productionArtworkId,
    staffUserId: staffUser.id,
  });
  if (ready.outcome !== "ready") throw new Error("setup failed");

  return {
    order,
    staffUser,
    line,
    proofGroupId: approved.proofGroupId,
    artworkId: artwork.productionArtworkId,
  };
}

describe("createExportBatch (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("exports a ready group: builds a real package, marks the artwork EXPORTED, the group EXPORTED_FOR_PRINT, and advances workflowStatus", async () => {
    const { order, staffUser, proofGroupId, artworkId } = await seedReadyToExportGroup(tracker);

    const result = await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      destination: "Test vendor",
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });

    expect(result.outcome).toBe("exported");
    if (result.outcome !== "exported") return;
    expect(result.batchNumber).toBe(1);

    const batch = await db.exportBatch.findUniqueOrThrow({ where: { id: result.exportBatchId } });
    expect(batch.status).toBe("EXPORTED");
    expect(batch.packageStorageKey).toBeTruthy();
    expect(batch.packageChecksum).toBeTruthy();
    expect(batch.manifestSnapshot).toBeTruthy();

    // The package genuinely exists in storage and is a real, non-empty ZIP.
    if (!batch.packageStorageKey) throw new Error("expected packageStorageKey to be set");
    const packageBuffer = await localDiskStorageAdapter.getObjectBuffer(batch.packageStorageKey);
    expect(packageBuffer.length).toBeGreaterThan(0);
    expect(packageBuffer.subarray(0, 2).toString("ascii")).toBe("PK"); // ZIP local-file-header signature

    const artwork = await db.productionArtwork.findUniqueOrThrow({ where: { id: artworkId } });
    expect(artwork.status).toBe("EXPORTED");
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("EXPORTED_FOR_PRINT");

    const refreshedOrder = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshedOrder.workflowStatus).toBe("EXPORTED_FOR_PRINT");
    expect(refreshedOrder.proofSummary).toBe("ALL_REQUIRED_PROOFS_EXPORTED");

    // An "Exported for Print" Shopify tag sync was attempted — fails
    // against the seeded dev shop's placeholder credentials (same honest-
    // failure pattern used throughout this suite), but the export itself
    // must still succeed regardless (proven by result.outcome above);
    // confirmed here via the recorded failure showing the hook fired.
    const tagFailure = await db.integrationFailure.findFirst({
      where: {
        shopId: order.shopId,
        integration: "SHOPIFY_TAG_UPDATE",
        action: "order_tag_sync",
        relatedOrderId: order.id,
      },
    });
    expect(tagFailure).not.toBeNull();
  }, 20000);

  it("rejects exporting a group whose artwork isn't marked ready", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const approved = await tracker.createApprovedGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineId: line.id,
    });
    // No production artwork at all yet.

    const result = await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [approved.proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });

    expect(result.outcome).toBe("rejected");
    expect(await db.exportBatch.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("returns the existing batch for a duplicate idempotency key rather than exporting twice", async () => {
    const { order, staffUser, proofGroupId } = await seedReadyToExportGroup(tracker);
    const idempotencyKey = randomUUID();

    const first = await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey,
    });
    const second = await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey,
    });

    expect(first.outcome).toBe("exported");
    expect(second.outcome).toBe("duplicate");
    if (first.outcome !== "exported" || second.outcome !== "duplicate") return;
    expect(second.exportBatchId).toBe(first.exportBatchId);
    expect(await db.exportBatch.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("never exports one group's artwork just because a sibling group in the same order was exported", async () => {
    const {
      order,
      staffUser,
      proofGroupId: exportedGroupId,
    } = await seedReadyToExportGroup(tracker);
    // A second, untouched group on the SAME order — must remain APPROVED,
    // not silently swept into the export.
    const line2 = await tracker.createOrderLine(order.id);
    const untouchedGroup = await tracker.createApprovedGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineId: line2.id,
      name: "Untouched sibling group",
    });

    const result = await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [exportedGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });
    expect(result.outcome).toBe("exported");

    const untouched = await db.proofGroup.findUniqueOrThrow({
      where: { id: untouchedGroup.proofGroupId },
    });
    expect(untouched.status).toBe("APPROVED");

    const refreshedOrder = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshedOrder.workflowStatus).toBe("PARTIALLY_EXPORTED");
  });

  it("under concurrent export attempts for the same group, exactly one succeeds and no duplicate export batch is created", async () => {
    const { order, staffUser, proofGroupId } = await seedReadyToExportGroup(tracker);

    const [a, b] = await Promise.all([
      createExportBatch({
        shopId: order.shopId,
        orderId: order.id,
        proofGroupIds: [proofGroupId],
        destination: null,
        staffUserId: staffUser.id,
        idempotencyKey: randomUUID(),
      }),
      createExportBatch({
        shopId: order.shopId,
        orderId: order.id,
        proofGroupIds: [proofGroupId],
        destination: null,
        staffUserId: staffUser.id,
        idempotencyKey: randomUUID(),
      }),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    // Exactly one genuinely exports; the other is rejected because the CAS
    // guard in the finalisation transaction found the artwork/group already
    // moved on — never two successful exports of the same group.
    expect(outcomes).toEqual(["exported", "rejected"]);

    const exportedCount = await db.exportBatch.count({
      where: { orderId: order.id, status: "EXPORTED" },
    });
    expect(exportedCount).toBe(1);
    const groupExportCount = await db.exportBatchItem.count({ where: { proofGroupId } });
    expect(groupExportCount).toBe(1);
  }, 20000);
});

describe("reExportBatch (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("requires a non-empty reason", async () => {
    const { order, staffUser, proofGroupId } = await seedReadyToExportGroup(tracker);
    await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });

    const result = await reExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
      reexportReason: "   ",
    });
    expect(result.outcome).toBe("rejected");
  });

  it("links the new batch to the previous one via previousBatchId once a fresh revision is exported", async () => {
    const { order, staffUser, line, proofGroupId } = await seedReadyToExportGroup(tracker);
    const firstExport = await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });
    expect(firstExport.outcome).toBe("exported");
    if (firstExport.outcome !== "exported") return;

    // Prepare and ready a corrected revision so the group is READY_FOR_EXPORT again.
    const correction = await createProductionArtwork({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: Buffer.concat([PDF_BYTES, Buffer.from("corrected")]),
      originalFilename: "artwork-v2.pdf",
      decorationMethod: null,
      placement: "Left chest",
      productionMetadata: null,
      staffUserId: staffUser.id,
      idempotencyKey: null,
    });
    if (correction.outcome !== "created") throw new Error("setup failed");
    await setProductionArtworkOrderLines({
      shopId: order.shopId,
      productionArtworkId: correction.productionArtworkId,
      allocations: [{ orderLineId: line.id, quantity: line.quantity }],
      staffUserId: staffUser.id,
    });
    await markProductionArtworkReady({
      shopId: order.shopId,
      productionArtworkId: correction.productionArtworkId,
      staffUserId: staffUser.id,
    });

    const reExport = await reExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
      reexportReason: "Corrected placement after original export.",
    });
    expect(reExport.outcome).toBe("exported");
    if (reExport.outcome !== "exported") return;

    const newBatch = await db.exportBatch.findUniqueOrThrow({
      where: { id: reExport.exportBatchId },
    });
    expect(newBatch.previousBatchId).toBe(firstExport.exportBatchId);
    expect(newBatch.reexportReason).toBe("Corrected placement after original export.");
  });
});

describe("recordExportPackageDownload (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("increments the download count and records an activity event", async () => {
    const { order, staffUser, proofGroupId } = await seedReadyToExportGroup(tracker);
    const exportResult = await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });
    if (exportResult.outcome !== "exported") throw new Error("setup failed");

    const download = await recordExportPackageDownload({
      shopId: order.shopId,
      exportBatchId: exportResult.exportBatchId,
      staffUserId: staffUser.id,
    });
    expect(download.outcome).toBe("recorded");

    const batch = await db.exportBatch.findUniqueOrThrow({
      where: { id: exportResult.exportBatchId },
    });
    expect(batch.downloadCount).toBe(1);
    expect(batch.lastDownloadedAt).not.toBeNull();

    const event = await db.activityEvent.findFirst({
      where: { entityType: "ExportBatch", eventType: "export_package_downloaded" },
    });
    expect(event).not.toBeNull();
  });

  it("rejects when the batch has no package yet", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const batch = await db.exportBatch.create({
      data: {
        shopId: order.shopId,
        orderId: order.id,
        batchNumber: 1,
        status: "PREPARING",
        idempotencyKey: randomUUID(),
        createdByStaffId: staffUser.id,
      },
    });
    const result = await recordExportPackageDownload({
      shopId: order.shopId,
      exportBatchId: batch.id,
      staffUserId: staffUser.id,
    });
    expect(result.outcome).toBe("rejected");
  });
});
