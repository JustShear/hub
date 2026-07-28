import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { setProofRequirement } from "~/domain/proofs/set-proof-requirement.server";
import { createProofTestTracker } from "./helpers";

describe("setProofRequirement (integration)", () => {
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

  it("moves UNDETERMINED to PROOF_REQUIRED with a reason, recording history via ActivityEvent", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);

    const result = await setProofRequirement({
      shopId: order.shopId,
      proofGroupId,
      targetRequirement: "REQUIRED",
      expectedRequirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      reason: "Customer requires sign-off before production.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "updated" });
    const requirement = await db.proofRequirement.findUnique({ where: { proofGroupId } });
    expect(requirement?.value).toBe("REQUIRED");
    expect(
      await db.activityEvent.count({
        where: { entityId: proofGroupId, eventType: "proof_requirement_changed" },
      }),
    ).toBe(1);
  });

  it("rejects a reason-less change", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);

    const result = await setProofRequirement({
      shopId: order.shopId,
      proofGroupId,
      targetRequirement: "REQUIRED",
      expectedRequirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      reason: "",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("treats setting the same value as an idempotent no-op", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);

    const result = await setProofRequirement({
      shopId: order.shopId,
      proofGroupId,
      targetRequirement: "UNDETERMINED",
      expectedRequirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      reason: "irrelevant",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "already_there" });
  });

  it("reports a conflict when the requirement changed since the client last saw it", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);

    await setProofRequirement({
      shopId: order.shopId,
      proofGroupId,
      targetRequirement: "REQUIRED",
      expectedRequirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      reason: "First decision.",
      staffUserId: staffUser.id,
    });

    const result = await setProofRequirement({
      shopId: order.shopId,
      proofGroupId,
      targetRequirement: "NOT_REQUIRED",
      expectedRequirement: "UNDETERMINED",
      noProofReason: "UNPRINTED_PRODUCT",
      noProofReasonNote: null,
      reason: "Stale attempt.",
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "conflict", actualRequirement: "REQUIRED" });
  });

  it("reopening a NO_PROOF_REQUIRED group requires a reason and records a ManualOverride", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const proofGroupId = await createGroup(staffUser.id, order.id, order.shopId);

    await setProofRequirement({
      shopId: order.shopId,
      proofGroupId,
      targetRequirement: "NOT_REQUIRED",
      expectedRequirement: "UNDETERMINED",
      noProofReason: "APPROVED_STANDARD_LOGO",
      noProofReasonNote: null,
      reason: "Standard logo, previously approved.",
      staffUserId: staffUser.id,
    });
    const groupAfterNoProof = await db.proofGroup.findUniqueOrThrow({
      where: { id: proofGroupId },
    });
    expect(groupAfterNoProof.status).toBe("NO_PROOF_REQUIRED");

    const reopenWithoutReason = await setProofRequirement({
      shopId: order.shopId,
      proofGroupId,
      targetRequirement: "REQUIRED",
      expectedRequirement: "NOT_REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      reason: "",
      staffUserId: staffUser.id,
    });
    expect(reopenWithoutReason).toMatchObject({ outcome: "rejected" });

    const reopenResult = await setProofRequirement({
      shopId: order.shopId,
      proofGroupId,
      targetRequirement: "REQUIRED",
      expectedRequirement: "NOT_REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      reason: "Customer changed their mind — now wants a new logo, needs a fresh proof.",
      staffUserId: staffUser.id,
    });
    expect(reopenResult).toMatchObject({ outcome: "updated" });

    const groupAfterReopen = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(groupAfterReopen.status).toBe("NOT_STARTED");
    const overrides = await db.manualOverride.findMany({
      where: { relatedEntityId: proofGroupId },
    });
    expect(overrides.length).toBeGreaterThanOrEqual(2); // one for setting NOT_REQUIRED, one for reopening
  });
});
