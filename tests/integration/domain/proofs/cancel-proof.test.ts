import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { createProofVersion } from "~/domain/proofs/create-proof-version.server";
import { cancelProofVersion } from "~/domain/proofs/cancel-proof-version.server";
import { cancelProofGroup } from "~/domain/proofs/cancel-proof-group.server";
import { sendProofRequest } from "~/domain/proofs/send-proof-request.server";
import { manuallyApproveProofVersion } from "~/domain/proofs/manually-approve-proof-version.server";
import { createProofTestTracker, PNG_BYTES } from "./helpers";

describe("cancelProofGroup / cancelProofVersion (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  async function createGroupWithVersion(staffUserId: string, orderId: string, shopId: string) {
    const groupResult = await createProofGroup({
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
    if (groupResult.outcome !== "created") throw new Error("setup failed");
    const versionResult = await createProofVersion({
      shopId,
      proofGroupId: groupResult.proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId,
    });
    if (versionResult.outcome !== "created") throw new Error("setup failed");
    return { proofGroupId: groupResult.proofGroupId, proofVersionId: versionResult.proofVersionId };
  }

  it("cancels a proof version with a reason, preserving the row (no hard delete)", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofVersionId } = await createGroupWithVersion(staffUser.id, order.id, order.shopId);

    const result = await cancelProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "Wrong artwork used.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "cancelled" });
    const version = await db.proofVersion.findUniqueOrThrow({ where: { id: proofVersionId } });
    expect(version.status).toBe("CANCELLED");
    expect(version.cancelReason).toBe("Wrong artwork used.");
    expect(version.cancelledAt).not.toBeNull();
  });

  it("rejects cancelling a version without a reason", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofVersionId } = await createGroupWithVersion(staffUser.id, order.id, order.shopId);

    const result = await cancelProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("treats cancelling an already-cancelled version as an idempotent no-op", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofVersionId } = await createGroupWithVersion(staffUser.id, order.id, order.shopId);

    await cancelProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "First reason.",
      staffUserId: staffUser.id,
    });
    const second = await cancelProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "Second attempt.",
      staffUserId: staffUser.id,
    });

    expect(second).toMatchObject({ outcome: "already_there" });
  });

  it("cancels a proof group with a reason, preserving linked lines/assets/version history", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const groupResult = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Cancellable group",
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

    const result = await cancelProofGroup({
      shopId: order.shopId,
      proofGroupId: groupResult.proofGroupId,
      reason: "Customer cancelled this decoration.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "cancelled" });
    const group = await db.proofGroup.findUniqueOrThrow({
      where: { id: groupResult.proofGroupId },
    });
    expect(group.status).toBe("CANCELLED");
    // Preserved, not deleted.
    expect(
      await db.proofGroupOrderLine.count({ where: { proofGroupId: groupResult.proofGroupId } }),
    ).toBe(1);
    expect(await db.proofVersion.count({ where: { proofGroupId: groupResult.proofGroupId } })).toBe(
      1,
    );
  });

  it("rejects cancelling a proof group without a reason", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await createGroupWithVersion(staffUser.id, order.id, order.shopId);

    const result = await cancelProofGroup({
      shopId: order.shopId,
      proofGroupId,
      reason: "   ",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("treats cancelling an already-cancelled group as an idempotent no-op", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await createGroupWithVersion(staffUser.id, order.id, order.shopId);

    await cancelProofGroup({
      shopId: order.shopId,
      proofGroupId,
      reason: "First.",
      staffUserId: staffUser.id,
    });
    const second = await cancelProofGroup({
      shopId: order.shopId,
      proofGroupId,
      reason: "Second.",
      staffUserId: staffUser.id,
    });

    expect(second).toMatchObject({ outcome: "already_there" });
  });

  // Shop-requested restriction: only a group that hasn't been sent to the
  // customer yet can be cancelled — the real history of a sent/resolved
  // proof needs to stay intact.
  it("rejects cancelling a group that's already been sent to the customer", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      name: "Already sent",
    });
    const sendResult = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });
    if (sendResult.outcome !== "sent") throw new Error("setup failed to send");

    const result = await cancelProofGroup({
      shopId: order.shopId,
      proofGroupId,
      reason: "Trying to cancel after sending.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("SENT");
  });

  it("rejects cancelling a group that's already been approved", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId, proofVersionId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      name: "Already approved",
    });
    const sendResult = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });
    if (sendResult.outcome !== "sent") throw new Error("setup failed to send");
    const approveResult = await manuallyApproveProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "Customer approved by phone",
      staffUserId: staffUser.id,
    });
    if (approveResult.outcome !== "approved") throw new Error("setup failed to approve");

    const result = await cancelProofGroup({
      shopId: order.shopId,
      proofGroupId,
      reason: "Trying to cancel after approval.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("APPROVED");
  });

  it.each(["NOT_STARTED", "DRAFT_IN_PROGRESS", "READY_TO_SEND"] as const)(
    "still allows cancelling a group in the %s status",
    async (status) => {
      const order = await tracker.createOrder();
      const staffUser = await tracker.createStaffUser();
      const { proofGroupId } = await createGroupWithVersion(staffUser.id, order.id, order.shopId);
      // createGroupWithVersion always lands at READY_TO_SEND (a version
      // exists) — force the other two pre-send statuses directly for this
      // parameterized case, since there's no domain action that un-sends a
      // version to get back to NOT_STARTED/DRAFT_IN_PROGRESS.
      if (status !== "READY_TO_SEND") {
        await db.proofGroup.update({ where: { id: proofGroupId }, data: { status } });
      }

      const result = await cancelProofGroup({
        shopId: order.shopId,
        proofGroupId,
        reason: `Cancelling from ${status}.`,
        staffUserId: staffUser.id,
      });

      expect(result).toMatchObject({ outcome: "cancelled" });
    },
  );
});
