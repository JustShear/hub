import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { sendProofRequest } from "~/domain/proofs/send-proof-request.server";
import { revokeProofRequest } from "~/domain/proofs/revoke-proof-request.server";
import { resendProofRequest } from "~/domain/proofs/resend-proof-request.server";
import { createProofTestTracker } from "./helpers";

describe("revokeProofRequest / resendProofRequest (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  async function sendSingleGroup() {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
    });
    const sendResult = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });
    if (sendResult.outcome !== "sent") throw new Error("setup failed");
    return {
      order,
      staffUser,
      proofGroupId,
      proofRequestId: sendResult.proofRequestId,
      rawToken: sendResult.rawToken,
    };
  }

  it("revokes a proof request with a reason, preserving the row", async () => {
    const { order, proofRequestId } = await sendSingleGroup();

    const result = await revokeProofRequest({
      shopId: order.shopId,
      proofRequestId,
      reason: "Sent to the wrong recipient.",
      staffUserId: (await tracker.createStaffUser()).id,
    });

    expect(result).toMatchObject({ outcome: "revoked" });
    const request = await db.proofRequest.findUniqueOrThrow({ where: { id: proofRequestId } });
    expect(request.revokedAt).not.toBeNull();
    expect(request.revokedReason).toBe("Sent to the wrong recipient.");
  });

  it("requires a reason to revoke", async () => {
    const { order, proofRequestId, staffUser } = await sendSingleGroup();

    const result = await revokeProofRequest({
      shopId: order.shopId,
      proofRequestId,
      reason: "   ",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("revoking an already-revoked request is an idempotent no-op", async () => {
    const { order, proofRequestId, staffUser } = await sendSingleGroup();

    await revokeProofRequest({
      shopId: order.shopId,
      proofRequestId,
      reason: "First revoke.",
      staffUserId: staffUser.id,
    });
    const second = await revokeProofRequest({
      shopId: order.shopId,
      proofRequestId,
      reason: "Second attempt.",
      staffUserId: staffUser.id,
    });

    expect(second).toMatchObject({ outcome: "already_there" });
  });

  it("revocation never undoes a response already recorded", async () => {
    const { order, staffUser, proofGroupId, proofRequestId, rawToken } = await sendSingleGroup();
    const { recordCustomerProofResponse } =
      await import("~/domain/proofs/record-customer-proof-response.server");
    const approval = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: `revoke-test-${proofRequestId}`,
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });
    expect(approval.outcome).toBe("recorded");

    await revokeProofRequest({
      shopId: order.shopId,
      proofRequestId,
      reason: "Testing preservation.",
      staffUserId: staffUser.id,
    });

    // The already-recorded approval and its resulting APPROVED status
    // remain fully intact after revocation.
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("APPROVED");
    if (approval.outcome === "recorded") {
      const response = await db.customerProofResponse.findUniqueOrThrow({
        where: { id: approval.responseId },
      });
      expect(response.responseType).toBe("APPROVED");
    }
  });

  it("resend reuses the same proof request and token — never creates a new request", async () => {
    const { order, staffUser, proofRequestId } = await sendSingleGroup();
    const requestCountBefore = await db.proofRequest.count({ where: { orderId: order.id } });

    const result = await resendProofRequest({
      shopId: order.shopId,
      proofRequestId,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "resent" });
    const requestCountAfter = await db.proofRequest.count({ where: { orderId: order.id } });
    expect(requestCountAfter).toBe(requestCountBefore);

    const dispatchCount = await db.klaviyoDispatch.count({ where: { proofRequestId } });
    expect(dispatchCount).toBe(2); // original send + resend
  });

  it("cannot resend a revoked request", async () => {
    const { order, staffUser, proofRequestId } = await sendSingleGroup();
    await revokeProofRequest({
      shopId: order.shopId,
      proofRequestId,
      reason: "Revoked before resend attempt.",
      staffUserId: staffUser.id,
    });

    const result = await resendProofRequest({
      shopId: order.shopId,
      proofRequestId,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("cannot resend an expired request", async () => {
    const { order, staffUser, proofRequestId } = await sendSingleGroup();
    await db.proofRequest.update({
      where: { id: proofRequestId },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });

    const result = await resendProofRequest({
      shopId: order.shopId,
      proofRequestId,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });
});
