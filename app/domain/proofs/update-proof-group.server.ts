import { ActorType, type DecorationMethod, type Priority } from "@prisma/client";
import { db } from "~/lib/db.server";
import { trimmedOrNull } from "~/lib/strings";

export interface UpdateProofGroupInput {
  shopId: string;
  proofGroupId: string;
  /** The group's `updatedAt` as last observed by the client — the optimistic-concurrency token. */
  expectedUpdatedAt: Date;
  name: string;
  decorationMethod: DecorationMethod;
  placement: string | null;
  description: string | null;
  dueDate: Date | null;
  priority: Priority;
  staffUserId: string;
}

export type UpdateProofGroupResult =
  | { outcome: "updated"; updatedAt: string }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string };

const STALE_EDIT_MESSAGE =
  "This proof group changed since you last saw it. Refresh to see the current value.";

export async function updateProofGroup(
  input: UpdateProofGroupInput,
): Promise<UpdateProofGroupResult> {
  const current = await db.proofGroup.findFirst({
    where: { id: input.proofGroupId, order: { shopId: input.shopId } },
  });
  if (!current) {
    return { outcome: "rejected", reason: "Proof group not found." };
  }
  if (current.status === "CANCELLED") {
    return {
      outcome: "rejected",
      reason: "This proof group is cancelled and can no longer be edited.",
    };
  }
  if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
    return { outcome: "conflict", reason: STALE_EDIT_MESSAGE };
  }

  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { outcome: "rejected", reason: "A proof group needs a name." };
  }

  const result = await db.$transaction(async (tx) => {
    const updateResult = await tx.proofGroup.updateMany({
      where: { id: input.proofGroupId, updatedAt: input.expectedUpdatedAt },
      data: {
        name: trimmedName,
        decorationMethod: input.decorationMethod,
        placement: trimmedOrNull(input.placement),
        artworkContextNote: trimmedOrNull(input.description),
        dueDate: input.dueDate,
        priority: input.priority,
      },
    });
    if (updateResult.count === 0) {
      return { conflict: true as const, updatedAt: null };
    }

    const updated = await tx.proofGroup.findUniqueOrThrow({
      where: { id: input.proofGroupId },
      select: { updatedAt: true },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: current.orderId,
        entityType: "ProofGroup",
        entityId: input.proofGroupId,
        eventType: "proof_group_updated",
        summary: `Proof group "${trimmedName}" updated`,
        metadata: {
          previous: {
            name: current.name,
            decorationMethod: current.decorationMethod,
            placement: current.placement,
            description: current.artworkContextNote,
            dueDate: current.dueDate,
            priority: current.priority,
          },
          new: {
            name: trimmedName,
            decorationMethod: input.decorationMethod,
            placement: input.placement,
            description: input.description,
            dueDate: input.dueDate,
            priority: input.priority,
          },
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    return { conflict: false as const, updatedAt: updated.updatedAt };
  });

  if (result.conflict) {
    return { outcome: "conflict", reason: STALE_EDIT_MESSAGE };
  }
  return { outcome: "updated", updatedAt: result.updatedAt.toISOString() };
}
