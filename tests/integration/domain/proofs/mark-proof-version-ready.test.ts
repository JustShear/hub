import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { createProofVersion } from "~/domain/proofs/create-proof-version.server";
import { markProofVersionReady } from "~/domain/proofs/mark-proof-version-ready.server";
import { createProofTestTracker, PNG_BYTES } from "./helpers";

describe("markProofVersionReady (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  it("marks a valid draft version ready to send and updates the group status", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const groupResult = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Left chest embroidery",
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
    if (groupResult.outcome !== "created") throw new Error("setup failed");
    const versionResult = await createProofVersion({
      shopId: order.shopId,
      proofGroupId: groupResult.proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });
    if (versionResult.outcome !== "created") throw new Error("setup failed");

    const result = await markProofVersionReady({
      shopId: order.shopId,
      proofVersionId: versionResult.proofVersionId,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "ready" });
    const version = await db.proofVersion.findUniqueOrThrow({
      where: { id: versionResult.proofVersionId },
    });
    expect(version.status).toBe("READY_TO_SEND");
    const group = await db.proofGroup.findUniqueOrThrow({
      where: { id: groupResult.proofGroupId },
    });
    expect(group.status).toBe("READY_TO_SEND");
  });

  it("rejects marking a version ready when the group has no linked order lines", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const groupResult = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "No lines linked",
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
      staffUserId: staffUser.id,
    });
    if (groupResult.outcome !== "created") throw new Error("setup failed");
    const versionResult = await createProofVersion({
      shopId: order.shopId,
      proofGroupId: groupResult.proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });
    if (versionResult.outcome !== "created") throw new Error("setup failed");

    const result = await markProofVersionReady({
      shopId: order.shopId,
      proofVersionId: versionResult.proofVersionId,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.issues?.some((i) => i.includes("order line"))).toBe(true);
    }
  });

  it("rejects marking a version ready when the requirement is UNDETERMINED", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const groupResult = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Undetermined group",
      decorationMethod: "EMBROIDERY",
      placement: "Left chest",
      description: null,
      requirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [line.id],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });
    if (groupResult.outcome !== "created") throw new Error("setup failed");
    const versionResult = await createProofVersion({
      shopId: order.shopId,
      proofGroupId: groupResult.proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });
    if (versionResult.outcome !== "created") throw new Error("setup failed");

    const result = await markProofVersionReady({
      shopId: order.shopId,
      proofVersionId: versionResult.proofVersionId,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
  });

  it("treats marking an already-ready version as an idempotent no-op", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const groupResult = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Ready group",
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
    if (groupResult.outcome !== "created") throw new Error("setup failed");
    const versionResult = await createProofVersion({
      shopId: order.shopId,
      proofGroupId: groupResult.proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });
    if (versionResult.outcome !== "created") throw new Error("setup failed");

    const first = await markProofVersionReady({
      shopId: order.shopId,
      proofVersionId: versionResult.proofVersionId,
      staffUserId: staffUser.id,
    });
    const second = await markProofVersionReady({
      shopId: order.shopId,
      proofVersionId: versionResult.proofVersionId,
      staffUserId: staffUser.id,
    });

    expect(first).toMatchObject({ outcome: "ready" });
    expect(second).toMatchObject({ outcome: "already_there" });
    expect(
      await db.activityEvent.count({
        where: { entityId: versionResult.proofVersionId, eventType: "proof_version_marked_ready" },
      }),
    ).toBe(1);
  });
});
