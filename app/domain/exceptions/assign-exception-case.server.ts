import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface AssignExceptionCaseInput {
  shopId: string;
  exceptionCaseId: string;
  /** null clears the assignment. */
  targetStaffUserId: string | null;
  expectedStaffUserId: string | null;
  staffUserId: string;
}

export type AssignExceptionCaseResult =
  | { outcome: "assigned"; staffUserId: string | null }
  | { outcome: "already_there"; staffUserId: string | null }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string; actualStaffUserId: string | null };

const STALE_EDIT_MESSAGE =
  "This exception case's assignment changed since you last saw it. Refresh to see the current value.";

export async function assignExceptionCase(
  input: AssignExceptionCaseInput,
): Promise<AssignExceptionCaseResult> {
  const exceptionCase = await db.exceptionCase.findFirst({
    where: { id: input.exceptionCaseId, shopId: input.shopId },
  });
  if (!exceptionCase) {
    return { outcome: "rejected", reason: "Exception case not found." };
  }

  if (exceptionCase.assignedStaffId === input.targetStaffUserId) {
    return { outcome: "already_there", staffUserId: exceptionCase.assignedStaffId };
  }
  if (exceptionCase.assignedStaffId !== input.expectedStaffUserId) {
    return {
      outcome: "conflict",
      reason: STALE_EDIT_MESSAGE,
      actualStaffUserId: exceptionCase.assignedStaffId,
    };
  }

  if (input.targetStaffUserId) {
    const targetStaff = await db.staffUser.findFirst({
      where: { id: input.targetStaffUserId, shopId: input.shopId, isActive: true },
    });
    if (!targetStaff) {
      return { outcome: "rejected", reason: "That staff member is not active or doesn't exist." };
    }
  }

  const transactionResult = await db.$transaction(async (tx) => {
    const updateResult = await tx.exceptionCase.updateMany({
      where: { id: input.exceptionCaseId, assignedStaffId: input.expectedStaffUserId },
      data: { assignedStaffId: input.targetStaffUserId },
    });
    if (updateResult.count === 0) {
      return { conflict: true as const };
    }

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: exceptionCase.orderId,
        entityType: "ExceptionCase",
        entityId: exceptionCase.id,
        eventType: "exception_case_assigned",
        summary: `Exception case ${exceptionCase.caseNumber} assignment changed`,
        metadata: {
          previousStaffUserId: exceptionCase.assignedStaffId,
          newStaffUserId: input.targetStaffUserId,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    if (input.targetStaffUserId && input.targetStaffUserId !== input.staffUserId) {
      await tx.notification.create({
        data: {
          staffUserId: input.targetStaffUserId,
          type: "exception_case_assigned",
          title: `Assigned to you: case ${exceptionCase.caseNumber}`,
          body: null,
          relatedEntityType: "ExceptionCase",
          relatedEntityId: exceptionCase.id,
        },
      });
    }

    return { conflict: false as const };
  });

  if (transactionResult.conflict) {
    const latest = await db.exceptionCase.findUnique({
      where: { id: input.exceptionCaseId },
      select: { assignedStaffId: true },
    });
    return {
      outcome: "conflict",
      reason: STALE_EDIT_MESSAGE,
      actualStaffUserId: latest?.assignedStaffId ?? null,
    };
  }

  return { outcome: "assigned", staffUserId: input.targetStaffUserId };
}
