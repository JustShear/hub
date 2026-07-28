import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { createProofVersion } from "~/domain/proofs/create-proof-version.server";
import { addProofNote } from "~/domain/proofs/add-proof-note.server";
import { createProofTestTracker, PNG_BYTES } from "./helpers";

describe("addProofNote (integration)", () => {
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
      requirement: "UNDETERMINED",
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

  it("creates a group-scoped note", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const group = await createGroup(staffUser.id, order.id, order.shopId);

    const result = await addProofNote({
      shopId: order.shopId,
      scope: { kind: "group", proofGroupId: group },
      body: "Waiting on customer to confirm thread colour.",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("created");
    const note = await db.proofNote.findFirstOrThrow({ where: { proofGroupId: group } });
    expect(note.proofVersionId).toBeNull();
    expect(
      await db.activityEvent.count({ where: { entityId: group, eventType: "proof_note_added" } }),
    ).toBe(1);
  });

  it("creates a version-scoped note", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const group = await createGroup(staffUser.id, order.id, order.shopId);
    const versionResult = await createProofVersion({
      shopId: order.shopId,
      proofGroupId: group,
      fileBuffer: PNG_BYTES,
      originalFilename: "proof.png",
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: staffUser.id,
    });
    if (versionResult.outcome !== "created") throw new Error("setup failed");

    const result = await addProofNote({
      shopId: order.shopId,
      scope: { kind: "version", proofVersionId: versionResult.proofVersionId },
      body: "Logo colour matches the approved sample.",
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("created");
    const note = await db.proofNote.findFirstOrThrow({
      where: { proofVersionId: versionResult.proofVersionId },
    });
    expect(note.proofGroupId).toBeNull();
  });

  it("rejects an empty note", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const group = await createGroup(staffUser.id, order.id, order.shopId);

    const result = await addProofNote({
      shopId: order.shopId,
      scope: { kind: "group", proofGroupId: group },
      body: "   ",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("treats an exact duplicate resubmission within the duplicate window as a no-op", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const group = await createGroup(staffUser.id, order.id, order.shopId);
    const input = {
      shopId: order.shopId,
      scope: { kind: "group" as const, proofGroupId: group },
      body: "Same note twice.",
      staffUserId: staffUser.id,
    };

    const first = await addProofNote(input);
    const second = await addProofNote(input);

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("duplicate");
    expect(await db.proofNote.count({ where: { proofGroupId: group } })).toBe(1);
  });
});
