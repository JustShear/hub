import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { sendProofRequest } from "~/domain/proofs/send-proof-request.server";
import { manuallyApproveProofVersion } from "~/domain/proofs/manually-approve-proof-version.server";
import { createProofTestTracker } from "./helpers";

describe("manuallyApproveProofVersion (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  async function sendSingleGroup(name = "Test group") {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId, proofVersionId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      name,
    });
    const sendResult = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });
    if (sendResult.outcome !== "sent") throw new Error("setup failed to send");
    return {
      order,
      staffUser,
      proofGroupId,
      proofVersionId,
      proofRequestId: sendResult.proofRequestId,
    };
  }

  it("requires a reason", async () => {
    const { proofVersionId, staffUser, order } = await sendSingleGroup();

    const result = await manuallyApproveProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "   ",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    const version = await db.proofVersion.findUniqueOrThrow({ where: { id: proofVersionId } });
    expect(version.status).toBe("SENT");
  });

  it("approves the version, the group, records a ManualOverride, and completes the proof request", async () => {
    const { proofVersionId, proofGroupId, proofRequestId, staffUser, order } =
      await sendSingleGroup();

    const result = await manuallyApproveProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "Customer approved by phone",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "approved" });

    const version = await db.proofVersion.findUniqueOrThrow({ where: { id: proofVersionId } });
    expect(version.status).toBe("APPROVED");
    expect(version.approvedAt).not.toBeNull();

    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("APPROVED");

    const request = await db.proofRequest.findUniqueOrThrow({ where: { id: proofRequestId } });
    expect(request.status).toBe("COMPLETED");

    const override = await db.manualOverride.findFirstOrThrow({
      where: { relatedEntityId: proofVersionId, overrideType: "MANUAL_PROOF_APPROVAL" },
    });
    expect(override.reason).toBe("Customer approved by phone");
    expect(override.staffUserId).toBe(staffUser.id);
  });

  // A manual approval should move the order's Kanban card to Proof Approved
  // the same way a real customer response does — same honest-failure
  // convention as every other Shopify-tag sync in this codebase: this test's
  // order has a fake shopifyOrderGid/shop credentials, so the real Shopify
  // call can't succeed, but the sync must still be genuinely attempted
  // (recorded as an IntegrationFailure) rather than silently skipped.
  it('attempts to sync the "proof_accepted" Shopify tag (records the attempt even though the real API call fails in tests)', async () => {
    const { proofVersionId, staffUser, order } = await sendSingleGroup();

    const result = await manuallyApproveProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "Customer approved by phone",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "approved" });

    const failure = await db.integrationFailure.findFirst({
      where: {
        shopId: order.shopId,
        integration: "SHOPIFY_TAG_UPDATE",
        action: "order_tag_sync",
        relatedOrderId: order.id,
      },
    });
    expect(failure).not.toBeNull();
  });

  it("rejects a version that isn't awaiting a response", async () => {
    const { proofVersionId, staffUser, order } = await sendSingleGroup();

    const first = await manuallyApproveProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "First approval",
      staffUserId: staffUser.id,
    });
    expect(first.outcome).toBe("approved");

    const second = await manuallyApproveProofVersion({
      shopId: order.shopId,
      proofVersionId,
      reason: "Second attempt",
      staffUserId: staffUser.id,
    });
    expect(second).toMatchObject({ outcome: "rejected" });
  });
});
