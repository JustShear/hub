import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { assignProofGroup } from "~/domain/proofs/assign-proof-group.server";
import { createProofTestTracker } from "./helpers";

describe("assignProofGroup (integration)", () => {
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

  it("assigns a proof group to an active staff member", async () => {
    const order = await tracker.createOrder();
    const actor = await tracker.createStaffUser();
    const target = await tracker.createStaffUser();
    const group = await createGroup(actor.id, order.id, order.shopId);

    const result = await assignProofGroup({
      shopId: order.shopId,
      proofGroupId: group,
      targetStaffUserId: target.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    expect(result).toMatchObject({ outcome: "assigned", staffUserId: target.id });
    const updated = await db.proofGroup.findUniqueOrThrow({ where: { id: group } });
    expect(updated.assignedStaffId).toBe(target.id);
  });

  it("rejects assigning to an inactive staff member", async () => {
    const order = await tracker.createOrder();
    const actor = await tracker.createStaffUser();
    const inactive = await tracker.createStaffUser(false);
    const group = await createGroup(actor.id, order.id, order.shopId);

    const result = await assignProofGroup({
      shopId: order.shopId,
      proofGroupId: group,
      targetStaffUserId: inactive.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("does not affect the order-level assignment or other proof groups on the same order", async () => {
    const order = await tracker.createOrder();
    const actor = await tracker.createStaffUser();
    const target = await tracker.createStaffUser();
    const groupA = await createGroup(actor.id, order.id, order.shopId);
    const groupB = await createGroup(actor.id, order.id, order.shopId);

    await assignProofGroup({
      shopId: order.shopId,
      proofGroupId: groupA,
      targetStaffUserId: target.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    const otherGroup = await db.proofGroup.findUniqueOrThrow({ where: { id: groupB } });
    expect(otherGroup.assignedStaffId).toBeNull();
    expect(await db.orderAssignment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("treats a duplicate assignment as an idempotent no-op with no duplicate ActivityEvent", async () => {
    const order = await tracker.createOrder();
    const actor = await tracker.createStaffUser();
    const target = await tracker.createStaffUser();
    const group = await createGroup(actor.id, order.id, order.shopId);

    const input = {
      shopId: order.shopId,
      proofGroupId: group,
      targetStaffUserId: target.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    };
    const first = await assignProofGroup(input);
    const second = await assignProofGroup(input);

    expect(first.outcome).toBe("assigned");
    expect(second).toMatchObject({ outcome: "already_there" });
    expect(
      await db.activityEvent.count({
        where: { entityId: group, eventType: "proof_group_assigned" },
      }),
    ).toBe(1);
  });

  it("reports a conflict when the assignment changed since the client last saw it", async () => {
    const order = await tracker.createOrder();
    const actor = await tracker.createStaffUser();
    const first = await tracker.createStaffUser();
    const second = await tracker.createStaffUser();
    const group = await createGroup(actor.id, order.id, order.shopId);

    await assignProofGroup({
      shopId: order.shopId,
      proofGroupId: group,
      targetStaffUserId: first.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    const result = await assignProofGroup({
      shopId: order.shopId,
      proofGroupId: group,
      targetStaffUserId: second.id,
      expectedStaffUserId: null,
      staffUserId: actor.id,
    });

    expect(result).toMatchObject({ outcome: "conflict", actualStaffUserId: first.id });
  });
});
