import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { sendProofRequest } from "~/domain/proofs/send-proof-request.server";
import { recordCustomerProofResponse } from "~/domain/proofs/record-customer-proof-response.server";
import { createProofTestTracker, PNG_BYTES } from "./helpers";

describe("recordCustomerProofResponse (integration)", () => {
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
    return { order, staffUser, proofGroupId, proofVersionId, rawToken: sendResult.rawToken };
  }

  it("approval requires the acknowledgement checkbox to be true", async () => {
    const { proofGroupId, rawToken } = await sendSingleGroup();

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: false,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: "test",
      files: [],
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("approval locks the exact version and marks the group APPROVED", async () => {
    const { order, proofGroupId, proofVersionId, rawToken } = await sendSingleGroup();

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: randomUUID(),
      requestIp: "203.0.113.4",
      requestUserAgent: "test-agent",
      files: [],
    });

    expect(result.outcome).toBe("recorded");
    const version = await db.proofVersion.findUniqueOrThrow({ where: { id: proofVersionId } });
    expect(version.status).toBe("APPROVED");
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("APPROVED");

    // A "proof_accepted" Shopify tag sync was attempted off the recalculated
    // order-level aggregate — fails against the seeded dev shop's
    // placeholder credentials, but the response itself must still be
    // recorded regardless (proven by result.outcome above); confirmed here
    // via the recorded failure showing the hook actually fired.
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

  it("change request requires either feedback text or an uploaded file", async () => {
    const { proofGroupId, rawToken } = await sendSingleGroup();

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "CHANGES_REQUESTED",
      customerNote: "   ",
      changeCategories: [],
      acknowledgedApproval: false,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("change request with feedback marks the version and group CHANGES_REQUESTED", async () => {
    const { order, proofGroupId, proofVersionId, rawToken } = await sendSingleGroup();

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "CHANGES_REQUESTED",
      customerNote: "Please make the logo bigger.",
      changeCategories: [],
      acknowledgedApproval: false,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });

    expect(result.outcome).toBe("recorded");
    const version = await db.proofVersion.findUniqueOrThrow({ where: { id: proofVersionId } });
    expect(version.status).toBe("CHANGES_REQUESTED");

    // A "proof_rejected" Shopify tag sync was attempted — see the identical
    // comment on the APPROVED case above.
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

  it("a marked-up upload is stored on CustomerResponseAsset, never on ProofAsset", async () => {
    const { proofGroupId, proofVersionId, rawToken } = await sendSingleGroup();

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "CHANGES_REQUESTED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: false,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [{ buffer: PNG_BYTES, originalFilename: "markup.png" }],
    });
    expect(result.outcome).toBe("recorded");
    if (result.outcome !== "recorded") throw new Error("unreachable");

    const responseAssets = await db.customerResponseAsset.count({
      where: { responseId: result.responseId },
    });
    expect(responseAssets).toBe(1);
    // The original internal proof file is untouched — still exactly one ProofAsset for this version.
    const proofAssets = await db.proofAsset.count({ where: { proofVersionId } });
    expect(proofAssets).toBe(1);
  });

  it("rejects an unsafe/invalid uploaded file", async () => {
    const { proofGroupId, rawToken } = await sendSingleGroup();

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "CHANGES_REQUESTED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: false,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [{ buffer: Buffer.from("not a real image or pdf"), originalFilename: "fake.png" }],
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("a duplicate submission with the same idempotency key is a no-op", async () => {
    const { proofGroupId, rawToken } = await sendSingleGroup();
    const idempotencyKey = randomUUID();
    const input = {
      rawToken,
      proofGroupId,
      responseType: "APPROVED" as const,
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey,
      requestIp: null,
      requestUserAgent: null,
      files: [],
    };

    const first = await recordCustomerProofResponse(input);
    const second = await recordCustomerProofResponse(input);

    expect(first.outcome).toBe("recorded");
    expect(second).toMatchObject({ outcome: "duplicate" });
    if (first.outcome === "recorded" && second.outcome === "duplicate") {
      expect(second.responseId).toBe(first.responseId);
    }
    const responseCount = await db.customerProofResponse.count({
      where: {
        proofVersionId: (await db.proofRequestGroup.findFirstOrThrow({ where: { proofGroupId } }))
          .proofVersionId,
      },
    });
    expect(responseCount).toBe(1);
  });

  it("cannot approve an obsolete/superseded version", async () => {
    const { order, staffUser, proofGroupId, rawToken } = await sendSingleGroup();
    // Staff creates a new version after sending — this supersedes the sent one.
    const { createProofVersion } = await import("~/domain/proofs/create-proof-version.server");
    await createProofVersion({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: PNG_BYTES,
      originalFilename: "v2.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("rejects a response for a proof group not included in this request", async () => {
    const { rawToken } = await sendSingleGroup();
    const order2 = await tracker.createOrder();
    const staffUser2 = await tracker.createStaffUser();
    const otherGroup = await tracker.createReadyGroup({
      orderId: order2.id,
      shopId: order2.shopId,
      staffUserId: staffUser2.id,
      name: "Other order's group",
    });

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId: otherGroup.proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("rejects an invalid token", async () => {
    const result = await recordCustomerProofResponse({
      rawToken: "not-a-real-token-at-all",
      proofGroupId: "does-not-matter",
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("rejects a revoked token", async () => {
    const { order, staffUser, proofGroupId, rawToken } = await sendSingleGroup();
    const { revokeProofRequest } = await import("~/domain/proofs/revoke-proof-request.server");
    const requestGroup = await db.proofRequestGroup.findFirstOrThrow({ where: { proofGroupId } });
    await revokeProofRequest({
      shopId: order.shopId,
      proofRequestId: requestGroup.proofRequestId,
      reason: "Test revoke",
      staffUserId: staffUser.id,
    });

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("an expired token is rejected", async () => {
    const { proofGroupId, rawToken } = await sendSingleGroup();
    const requestGroup = await db.proofRequestGroup.findFirstOrThrow({ where: { proofGroupId } });
    await db.proofRequest.update({
      where: { id: requestGroup.proofRequestId },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });

    const result = await recordCustomerProofResponse({
      rawToken,
      proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("approving one group in a multi-group request never affects a sibling group", async () => {
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
    const sendResult = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [groupA.proofGroupId, groupB.proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });
    if (sendResult.outcome !== "sent") throw new Error("setup failed");

    await recordCustomerProofResponse({
      rawToken: sendResult.rawToken,
      proofGroupId: groupA.proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });

    const groupBRow = await db.proofGroup.findUniqueOrThrow({ where: { id: groupB.proofGroupId } });
    expect(groupBRow.status).toBe("SENT");
    const groupARow = await db.proofGroup.findUniqueOrThrow({ where: { id: groupA.proofGroupId } });
    expect(groupARow.status).toBe("APPROVED");

    // Request stays partially responded — not complete — until group B also resolves.
    const request = await db.proofRequest.findUniqueOrThrow({
      where: { id: sendResult.proofRequestId },
    });
    expect(request.status).toBe("PARTIALLY_RESPONDED");
  });

  it("a request becomes COMPLETED only once every included group has a terminal response", async () => {
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
    const sendResult = await sendProofRequest({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [groupA.proofGroupId, groupB.proofGroupId],
      staffMessage: null,
      staffUserId: staffUser.id,
    });
    if (sendResult.outcome !== "sent") throw new Error("setup failed");

    await recordCustomerProofResponse({
      rawToken: sendResult.rawToken,
      proofGroupId: groupA.proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });
    await recordCustomerProofResponse({
      rawToken: sendResult.rawToken,
      proofGroupId: groupB.proofGroupId,
      responseType: "CHANGES_REQUESTED",
      customerNote: "Needs work",
      changeCategories: [],
      acknowledgedApproval: false,
      idempotencyKey: randomUUID(),
      requestIp: null,
      requestUserAgent: null,
      files: [],
    });

    const request = await db.proofRequest.findUniqueOrThrow({
      where: { id: sendResult.proofRequestId },
    });
    expect(request.status).toBe("COMPLETED");
    expect(request.completedAt).not.toBeNull();
  });

  it("concurrent approve + change-request on the same group/version produce exactly one terminal result", async () => {
    const { proofGroupId, proofVersionId, rawToken } = await sendSingleGroup();

    const [approveResult, changesResult] = await Promise.all([
      recordCustomerProofResponse({
        rawToken,
        proofGroupId,
        responseType: "APPROVED",
        customerNote: null,
        changeCategories: [],
        acknowledgedApproval: true,
        idempotencyKey: randomUUID(),
        requestIp: null,
        requestUserAgent: null,
        files: [],
      }),
      recordCustomerProofResponse({
        rawToken,
        proofGroupId,
        responseType: "CHANGES_REQUESTED",
        customerNote: "Racing submission",
        changeCategories: [],
        acknowledgedApproval: false,
        idempotencyKey: randomUUID(),
        requestIp: null,
        requestUserAgent: null,
        files: [],
      }),
    ]);

    const outcomes = [approveResult.outcome, changesResult.outcome];
    // Exactly one succeeds; the other is rejected as no-longer-actionable.
    expect(outcomes.filter((o) => o === "recorded")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "rejected")).toHaveLength(1);

    const version = await db.proofVersion.findUniqueOrThrow({ where: { id: proofVersionId } });
    expect(["APPROVED", "CHANGES_REQUESTED"]).toContain(version.status);
    const responseCount = await db.customerProofResponse.count({ where: { proofVersionId } });
    expect(responseCount).toBe(1);
  });
});
