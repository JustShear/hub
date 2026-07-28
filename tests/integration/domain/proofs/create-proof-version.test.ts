import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { createProofVersion } from "~/domain/proofs/create-proof-version.server";
import { localDiskStorageAdapter } from "~/adapters/storage/local-disk-storage.server";
import { createProofTestTracker, PNG_BYTES, PDF_BYTES } from "./helpers";

describe("createProofVersion (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  async function createGroup(staffUserId: string, orderId: string, shopId: string) {
    const result = await createProofGroup({
      shopId,
      orderId,
      name: "Test group",
      decorationMethod: "EMBROIDERY",
      placement: "Left chest",
      description: null,
      requirement: "REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId,
    });
    if (result.outcome !== "created") throw new Error("failed to create test group");
    return result.proofGroupId;
  }

  it("creates version 1 with real file metadata (checksum, size, mime type, dimensions)", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);

    const result = await createProofVersion({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: "First pass.",
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "created", versionNumber: 1 });
    if (result.outcome !== "created") return;
    const asset = await db.proofAsset.findFirstOrThrow({
      where: { proofVersionId: result.proofVersionId },
    });
    expect(asset.mimeType).toBe("image/png");
    expect(asset.sizeBytes).toBe(PNG_BYTES.length);
    expect(asset.checksum).toHaveLength(64); // sha256 hex
    expect(asset.width).toBe(1);
    expect(asset.height).toBe(1);

    const stored = await localDiskStorageAdapter.getObjectBuffer(asset.storageKey);
    expect(stored.equals(PNG_BYTES)).toBe(true);
  });

  it("assigns sequential version numbers and supersedes the previous draft", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);

    const v1 = await createProofVersion({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "v1.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });
    const v2 = await createProofVersion({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: PDF_BYTES,
      originalFilename: "v2.pdf",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });

    expect(v1).toMatchObject({ outcome: "created", versionNumber: 1 });
    expect(v2).toMatchObject({ outcome: "created", versionNumber: 2 });
    if (v1.outcome !== "created" || v2.outcome !== "created") return;

    const version1 = await db.proofVersion.findUniqueOrThrow({ where: { id: v1.proofVersionId } });
    expect(version1.status).toBe("SUPERSEDED");
    expect(version1.supersededByVersionId).toBe(v2.proofVersionId);

    const version2 = await db.proofVersion.findUniqueOrThrow({ where: { id: v2.proofVersionId } });
    expect(version2.status).toBe("DRAFT");

    // Older files remain in storage — never deleted when superseded.
    const oldAsset = await db.proofAsset.findFirstOrThrow({
      where: { proofVersionId: v1.proofVersionId },
    });
    const buffer = await localDiskStorageAdapter.getObjectBuffer(oldAsset.storageKey);
    expect(buffer.equals(PNG_BYTES)).toBe(true);
  });

  it("does not create duplicate version numbers under concurrent creation", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);

    const [a, b] = await Promise.all([
      createProofVersion({
        shopId: order.shopId,
        proofGroupId,
        fileBuffer: PNG_BYTES,
        originalFilename: "concurrent-a.png",
        internalNote: null,
        sourceAssetIds: [],
        idempotencyKey: null,
        staffUserId: staffUser.id,
      }),
      createProofVersion({
        shopId: order.shopId,
        proofGroupId,
        fileBuffer: PDF_BYTES,
        originalFilename: "concurrent-b.pdf",
        internalNote: null,
        sourceAssetIds: [],
        idempotencyKey: null,
        staffUserId: staffUser.id,
      }),
    ]);

    expect(a.outcome).toBe("created");
    expect(b.outcome).toBe("created");
    if (a.outcome !== "created" || b.outcome !== "created") return;

    // Both succeeded with distinct version numbers — no duplicate, no error surfaced.
    expect(new Set([a.versionNumber, b.versionNumber]).size).toBe(2);
    expect([a.versionNumber, b.versionNumber].sort()).toEqual([1, 2]);

    const allVersions = await db.proofVersion.findMany({ where: { proofGroupId } });
    expect(allVersions).toHaveLength(2);
  });

  it("treats a resubmission with the same idempotency key as a no-op, not a duplicate version", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);
    const idempotencyKey = "test-idempotency-key-1";

    const first = await createProofVersion({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "retry.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey,
      staffUserId: staffUser.id,
    });
    const second = await createProofVersion({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "retry.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey,
      staffUserId: staffUser.id,
    });

    expect(first.outcome).toBe("created");
    expect(second).toMatchObject({ outcome: "duplicate" });
    if (first.outcome === "created" && second.outcome === "duplicate") {
      expect(second.proofVersionId).toBe(first.proofVersionId);
    }
    expect(await db.proofVersion.count({ where: { proofGroupId } })).toBe(1);
  });

  it("rejects an unsupported file type", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);

    const result = await createProofVersion({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: Buffer.from("not a real proof file"),
      originalFilename: "malicious.exe",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    expect(await db.proofVersion.count({ where: { proofGroupId } })).toBe(0);
  });

  it("rejects creating a version on a NO_PROOF_REQUIRED group", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const groupResult = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "No proof needed",
      decorationMethod: "UNPRINTED",
      placement: null,
      description: null,
      requirement: "NOT_REQUIRED",
      noProofReason: "UNPRINTED_PRODUCT",
      noProofReasonNote: null,
      orderLineIds: [],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });
    if (groupResult.outcome !== "created") throw new Error("setup failed");

    const result = await createProofVersion({
      shopId: order.shopId,
      proofGroupId: groupResult.proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("rejects creating a version on a cancelled group", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);
    await db.proofGroup.update({
      where: { id: proofGroupId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "test" },
    });

    const result = await createProofVersion({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });
});
