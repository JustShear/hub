import { afterAll, describe, expect, it } from "vitest";
import { sendProofRequest } from "~/domain/proofs/send-proof-request.server";
import { loadProofRequestsForOrder } from "~/domain/proofs/proof-request-query.server";
import { createProofTestTracker } from "./helpers";

describe("loadProofRequestsForOrder — reviewUrl (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  it("surfaces the exact customer-facing review URL (embedding the raw token) that was sent", async () => {
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

    const requests = await loadProofRequestsForOrder({
      shopId: order.shopId,
      orderId: order.id,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.reviewUrl).toContain(`/proof/${sendResult.rawToken}`);
  });
});
