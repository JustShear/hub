import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProductionArtwork } from "~/domain/production/create-production-artwork.server";
import { createProductionTestTracker, PDF_BYTES } from "./helpers";

describe("createProductionArtwork (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("creates a revision on the approved-version path, snapshotting the source version", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const approved = await tracker.createApprovedGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineId: line.id,
    });

    const result = await createProductionArtwork({
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

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    expect(result.revisionNumber).toBe(1);

    const artwork = await db.productionArtwork.findUniqueOrThrow({
      where: { id: result.productionArtworkId },
    });
    expect(artwork.sourceProofVersionId).toBe(approved.proofVersionId);
    expect(artwork.sourceNoProofReasonSnapshot).toBeNull();
    expect(artwork.status).toBe("DRAFT");
    expect(artwork.validationStatus).toBe(true);
  });

  it("creates a revision on the no-proof-required path, snapshotting the reason", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const proofGroupId = await tracker.createNoProofRequiredGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineId: line.id,
    });

    const result = await createProductionArtwork({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: PDF_BYTES,
      originalFilename: "artwork.pdf",
      decorationMethod: null,
      placement: "Front badge",
      productionMetadata: null,
      staffUserId: staffUser.id,
      idempotencyKey: null,
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    const artwork = await db.productionArtwork.findUniqueOrThrow({
      where: { id: result.productionArtworkId },
    });
    expect(artwork.sourceProofVersionId).toBeNull();
    expect(artwork.sourceNoProofReasonSnapshot).toBe("APPROVED_STANDARD_LOGO");
  });

  it("rejects a group that isn't export-eligible yet", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    // A freshly created group (NOT_STARTED / no version) is not eligible.
    const { createProofGroup } = await import("~/domain/proofs/create-proof-group.server");
    const group = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Not yet approved",
      decorationMethod: "EMBROIDERY",
      placement: "Left chest",
      description: null,
      requirement: "REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [line.id],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });
    if (group.outcome !== "created") throw new Error("setup failed");

    const result = await createProductionArtwork({
      shopId: order.shopId,
      proofGroupId: group.proofGroupId,
      fileBuffer: PDF_BYTES,
      originalFilename: "artwork.pdf",
      decorationMethod: null,
      placement: "Left chest",
      productionMetadata: null,
      staffUserId: staffUser.id,
      idempotencyKey: null,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("rejects a file that doesn't match any accepted signature or the EMB extension exception", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const approved = await tracker.createApprovedGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineId: line.id,
    });

    const result = await createProductionArtwork({
      shopId: order.shopId,
      proofGroupId: approved.proofGroupId,
      fileBuffer: Buffer.from("not a real file"),
      originalFilename: "artwork.docx",
      decorationMethod: null,
      placement: "Left chest",
      productionMetadata: null,
      staffUserId: staffUser.id,
      idempotencyKey: null,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("supersedes a prior DRAFT revision when a new one is created, never overwriting it", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const approved = await tracker.createApprovedGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineId: line.id,
    });

    const v1 = await createProductionArtwork({
      shopId: order.shopId,
      proofGroupId: approved.proofGroupId,
      fileBuffer: PDF_BYTES,
      originalFilename: "v1.pdf",
      decorationMethod: null,
      placement: "Left chest",
      productionMetadata: null,
      staffUserId: staffUser.id,
      idempotencyKey: null,
    });
    if (v1.outcome !== "created") throw new Error("setup failed");

    const v2 = await createProductionArtwork({
      shopId: order.shopId,
      proofGroupId: approved.proofGroupId,
      fileBuffer: Buffer.concat([PDF_BYTES, Buffer.from("more")]),
      originalFilename: "v2.pdf",
      decorationMethod: null,
      placement: "Left chest",
      productionMetadata: null,
      staffUserId: staffUser.id,
      idempotencyKey: null,
    });
    expect(v2.outcome).toBe("created");
    if (v2.outcome !== "created") return;
    expect(v2.revisionNumber).toBe(2);

    const v1Row = await db.productionArtwork.findUniqueOrThrow({
      where: { id: v1.productionArtworkId },
    });
    expect(v1Row.status).toBe("SUPERSEDED");
    expect(v1Row.supersededByArtworkId).toBe(v2.productionArtworkId);
    // The superseded row is never deleted — its file/checksum are preserved.
    expect(v1Row.storageKey).toBeTruthy();
  });

  it("returns the existing revision for an idempotent resubmission (same group, same content, same key)", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const approved = await tracker.createApprovedGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineId: line.id,
    });

    const input = {
      shopId: order.shopId,
      proofGroupId: approved.proofGroupId,
      fileBuffer: PDF_BYTES,
      originalFilename: "artwork.pdf",
      decorationMethod: null,
      placement: "Left chest",
      productionMetadata: null,
      staffUserId: staffUser.id,
      idempotencyKey: "test-idempotency-key",
    } as const;

    const first = await createProductionArtwork(input);
    expect(first.outcome).toBe("created");
    const second = await createProductionArtwork(input);
    expect(second.outcome).toBe("duplicate");
    if (first.outcome !== "created" || second.outcome !== "duplicate") return;
    expect(second.productionArtworkId).toBe(first.productionArtworkId);

    const count = await db.productionArtwork.count({
      where: { proofGroupId: approved.proofGroupId },
    });
    expect(count).toBe(1);
  });
});
