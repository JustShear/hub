import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface AssignProofGroupInput {
  shopId: string;
  proofGroupId: string;
  /** null clears the assignment. */
  targetStaffUserId: string | null;
  expectedStaffUserId: string | null;
  staffUserId: string;
}

export type AssignProofGroupResult =
  | { outcome: "assigned"; staffUserId: string | null; staffUserName: string | null }
  | { outcome: "already_there"; staffUserId: string | null }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualStaffUserId: string | null };

const STALE_EDIT_MESSAGE =
  "This proof group's assignment changed since you last saw it. Refresh to see the current value.";

// Proof-group assignment is deliberately separate from the order's own
// assignment (Milestone 07's ARTWORK-role slot) — an order can have several
// proof groups assigned to different staff members, and assigning one never
// touches the order-level assignment or any other group on the same order.
export async function assignProofGroup(
  input: AssignProofGroupInput,
): Promise<AssignProofGroupResult> {
  const group = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
  });
  if (!group) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }
  if (group.status === "CANCELLED") {
    return { outcome: "rejected", reason: "This proof group is cancelled." };
  }

  if (group.assignedStaffId === input.targetStaffUserId) {
    return { outcome: "already_there", staffUserId: group.assignedStaffId };
  }
  if (group.assignedStaffId !== input.expectedStaffUserId) {
    return {
      outcome: "conflict",
      reason: STALE_EDIT_MESSAGE,
      actualStaffUserId: group.assignedStaffId,
    };
  }

  let targetStaffName: string | null = null;
  if (input.targetStaffUserId) {
    const targetStaff = await db.staffUser.findFirst({
      where: { id: input.targetStaffUserId, shopId: input.shopId, isActive: true },
    });
    if (!targetStaff) {
      return { outcome: "rejected", reason: "That staff member is not active or doesn't exist." };
    }
    targetStaffName = targetStaff.name;
  }

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.proofGroup.updateMany({
      where: { id: input.proofGroupId, assignedStaffId: input.expectedStaffUserId },
      data: { assignedStaffId: input.targetStaffUserId },
    });
    if (updateResult.count === 0) {
      return { conflict: true as const };
    }

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: group.orderId,
        entityType: "ProofGroup",
        entityId: group.id,
        eventType: "proof_group_assigned",
        summary: `Proof group "${group.name}" assignment changed`,
        metadata: {
          previousStaffUserId: group.assignedStaffId,
          newStaffUserId: input.targetStaffUserId,
          source: "order_drawer",
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return { conflict: false as const };
  });

  if (transactionResult.conflict) {
    const latest = await db.proofGroup.findUnique({
      where: { id: input.proofGroupId },
      select: { assignedStaffId: true },
    });
    return {
      outcome: "conflict",
      reason: STALE_EDIT_MESSAGE,
      actualStaffUserId: latest?.assignedStaffId ?? null,
    };
  }

  return {
    outcome: "assigned",
    staffUserId: input.targetStaffUserId,
    staffUserName: targetStaffName,
  };
}
