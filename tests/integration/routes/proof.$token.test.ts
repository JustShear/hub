// @vitest-environment node
//
// This route test constructs a real multipart Request (File + FormData) for
// the change-request-with-upload case. The suite's default jsdom
// environment provides its own File/FormData classes that aren't
// brand-compatible with the Request implementation's multipart serializer,
// so this file opts back into Node's native fetch globals — the same realm
// the route actually runs in during production (see the identical note in
// tests/integration/routes/orders.$orderId.proof-groups.test.ts).
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { sendProofRequest } from "~/domain/proofs/send-proof-request.server";
import { loader as portalLoader } from "~/routes/proof.$token";
import { action as respondAction } from "~/routes/proof.$token.respond";
import { createProofTestTracker, PNG_BYTES } from "~/../tests/integration/domain/proofs/helpers";

describe("public proof portal route (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  async function sendSingleGroup() {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      name: "Test group",
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

  it("returns an honest invalid-link state for a garbage token", async () => {
    const result = await portalLoader({
      params: { token: "not-a-real-token" },
      request: new Request("http://localhost/proof/not-a-real-token"),
      context: {},
    } as never);

    expect(result).toMatchObject({ valid: false, reason: "not_found" });
  });

  it("returns portal data for a valid token, scoped to only the sent groups", async () => {
    const { order, staffUser, rawToken } = await sendSingleGroup();
    // A second, unrelated group on the same order, never sent — must not appear.
    await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      name: "Never sent",
    });

    const result = await portalLoader({
      params: { token: rawToken },
      request: new Request(`http://localhost/proof/${rawToken}`),
      context: {},
    } as never);

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("unreachable");
    expect(result.data.groups).toHaveLength(1);
    expect(result.data.groups[0]?.name).toBe("Test group");
  });

  it("GET (the loader) never mutates view tracking or response state", async () => {
    const { rawToken, proofRequestId } = await sendSingleGroup();

    await portalLoader({
      params: { token: rawToken },
      request: new Request(`http://localhost/proof/${rawToken}`),
      context: {},
    } as never);

    const request = await db.proofRequest.findUniqueOrThrow({ where: { id: proofRequestId } });
    expect(request.viewCount).toBe(0);
    expect(request.firstViewedAt).toBeNull();
    expect(request.status).toBe("SENT");
  });

  it("the view intent (a POST) records a view; opening the page alone never does", async () => {
    const { rawToken, proofRequestId } = await sendSingleGroup();
    const formData = new FormData();
    formData.set("_intent", "view");

    const result = await respondAction({
      params: { token: rawToken },
      request: new Request(`http://localhost/proof/${rawToken}/respond`, {
        method: "POST",
        body: formData,
      }),
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    const request = await db.proofRequest.findUniqueOrThrow({ where: { id: proofRequestId } });
    expect(request.viewCount).toBe(1);
    expect(request.firstViewedAt).not.toBeNull();
  });

  it("rejects an approval submitted without the acknowledgement checkbox", async () => {
    const { rawToken, proofGroupId } = await sendSingleGroup();
    const formData = new FormData();
    formData.set("_intent", "approve");
    formData.set("proofGroupId", proofGroupId);
    formData.set("idempotencyKey", crypto.randomUUID());
    formData.set("acknowledgedApproval", "false");

    const result = await respondAction({
      params: { token: rawToken },
      request: new Request(`http://localhost/proof/${rawToken}/respond`, {
        method: "POST",
        body: formData,
      }),
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("SENT");
  });

  it("approves a proof group end-to-end through the route action", async () => {
    const { rawToken, proofGroupId } = await sendSingleGroup();
    const formData = new FormData();
    formData.set("_intent", "approve");
    formData.set("proofGroupId", proofGroupId);
    formData.set("idempotencyKey", crypto.randomUUID());
    formData.set("acknowledgedApproval", "true");

    const result = await respondAction({
      params: { token: rawToken },
      request: new Request(`http://localhost/proof/${rawToken}/respond`, {
        method: "POST",
        body: formData,
      }),
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("APPROVED");
  });

  it("requests changes with an uploaded marked-up file end-to-end through the route action", async () => {
    const { rawToken, proofGroupId } = await sendSingleGroup();
    const formData = new FormData();
    formData.set("_intent", "requestChanges");
    formData.set("proofGroupId", proofGroupId);
    formData.set("idempotencyKey", crypto.randomUUID());
    formData.set("customerNote", "Please adjust the colour.");
    formData.set("file", new File([PNG_BYTES], "markup.png", { type: "image/png" }));

    const result = await respondAction({
      params: { token: rawToken },
      request: new Request(`http://localhost/proof/${rawToken}/respond`, {
        method: "POST",
        body: formData,
      }),
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("CHANGES_REQUESTED");
  });

  it("a GET-style request can never approve or reject — the action only ever runs on POST", async () => {
    // React Router only invokes a route's `action` export for
    // POST/PUT/PATCH/DELETE — a GET is routed to `loader` instead, which
    // this route module doesn't wire to any mutation at all. This test
    // documents that invariant directly against the exported loader.
    const { rawToken, proofGroupId } = await sendSingleGroup();

    await portalLoader({
      params: { token: rawToken },
      request: new Request(`http://localhost/proof/${rawToken}`, { method: "GET" }),
      context: {},
    } as never);

    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("SENT");
  });
});
