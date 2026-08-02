import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { sendProofRequest } from "~/domain/proofs/send-proof-request.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { createProofTestTracker } from "./helpers";

describe("sendProofRequest (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  it("sends a request for a ready group and records the exact version sent", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const { proofGroupId, proofVersionId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineIds: [line.id],
    });

    const result = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      staffMessage: "Please take a look",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("sent");
    if (result.outcome !== "sent") throw new Error("unreachable");
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);

    const proofRequest = await db.proofRequest.findUniqueOrThrow({
      where: { id: result.proofRequestId },
    });
    expect(proofRequest.tokenHash).not.toBe(result.rawToken);
    expect(proofRequest.customerEmail).toBe(order.customerEmail);
    expect(proofRequest.status).toBe("SENT");

    const link = await db.proofRequestGroup.findUniqueOrThrow({
      where: {
        proofRequestId_proofGroupId: { proofRequestId: result.proofRequestId, proofGroupId },
      },
    });
    expect(link.proofVersionId).toBe(proofVersionId);

    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("SENT");
    const version = await db.proofVersion.findUniqueOrThrow({ where: { id: proofVersionId } });
    expect(version.status).toBe("SENT");

    // One automatic reminder is scheduled as part of sending.
    const reminder = await db.proofReminder.findUnique({
      where: { proofRequestId: result.proofRequestId },
    });
    expect(reminder).not.toBeNull();

    // The "proof_sent" Shopify tag sync was attempted — the seeded dev
    // shop's Shopify credentials are placeholders, so it genuinely fails
    // (same honest-failure pattern as the Klaviyo dispatch above), but the
    // send itself must still succeed regardless — proven by result.outcome
    // already being "sent" above, and confirmed here via the recorded
    // failure showing the hook actually fired.
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

  it("rejects sending when the order is cancelled", async () => {
    const order = await tracker.createOrder({ cancelledAt: new Date() });
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
    });

    const result = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("rejects sending when the order has no customer email", async () => {
    const order = await tracker.createOrder({ customerEmail: null });
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
    });

    const result = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("rejects a group that isn't marked ready to send (still DRAFT_IN_PROGRESS internally)", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const notReadyGroup = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Not ready group",
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
    if (notReadyGroup.outcome !== "created") throw new Error("setup failed");

    const result = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [notReadyGroup.proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    if (result.outcome === "rejected") {
      expect(result.issues?.length).toBeGreaterThan(0);
    }
  });

  it("does not send partially valid selections silently — all-or-nothing", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const ready = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
    });

    const result = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [ready.proofGroupId, "not-a-real-group"],
      staffMessage: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    // The valid group must NOT have been sent as a side effect.
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: ready.proofGroupId } });
    expect(group.status).toBe("READY_TO_SEND");
  });

  it("requires at least one selected proof group", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const result = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [],
      staffMessage: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("bundles several proof groups into one proof request", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const groupA = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      name: "Group A",
    });
    const groupB = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      name: "Group B",
    });

    const result = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [groupA.proofGroupId, groupB.proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("sent");
    if (result.outcome !== "sent") throw new Error("unreachable");
    const links = await db.proofRequestGroup.count({
      where: { proofRequestId: result.proofRequestId },
    });
    expect(links).toBe(2);
  });
});
