import { ActorType, type ExceptionCaseCategory, type Severity } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isTerminalCaseStatus } from "~/domain/exceptions/case-transitions";

export interface UpdateExceptionCaseInput {
  shopId: string;
  exceptionCaseId: string;
  /** The case's `updatedAt` as last observed by the client — the optimistic-concurrency token. */
  expectedUpdatedAt: Date;
  category: ExceptionCaseCategory;
  severity: Severity;
  summary: string;
  customerNote: string | null;
  staffUserId: string;
}

export type UpdateExceptionCaseResult =
  | { outcome: "updated"; updatedAt: string }
  | { outcome: "rejected"; reason: string }
  | { outcome: "conflict"; reason: string };

const STALE_EDIT_MESSAGE =
  "This exception case changed since you last saw it. Refresh to see the current value.";

export async function updateExceptionCase(
  input: UpdateExceptionCaseInput,
): Promise<UpdateExceptionCaseResult> {
  const current = await db.exceptionCase.findFirst({
    where: { id: input.exceptionCaseId, shopId: input.shopId },
  });
  if (!current) {
    return { outcome: "rejected", reason: "Exception case not found." };
  }
  if (isTerminalCaseStatus(current.status)) {
    return {
      outcome: "rejected",
      reason: "This exception case has already reached a terminal status and can't be edited.",
    };
  }
  if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
    return { outcome: "conflict", reason: STALE_EDIT_MESSAGE };
  }

  const trimmedSummary = input.summary.trim();
  if (!trimmedSummary) {
    return { outcome: "rejected", reason: "A summary of what happened is required." };
  }

  const result = await db.$transaction(async (tx) => {
    const updateResult = await tx.exceptionCase.updateMany({
      where: { id: input.exceptionCaseId, updatedAt: input.expectedUpdatedAt },
      data: {
        category: input.category,
        severity: input.severity,
        summary: trimmedSummary,
        customerNote: input.customerNote,
      },
    });
    if (updateResult.count === 0) {
      return { conflict: true as const, updatedAt: null };
    }

    const updated = await tx.exceptionCase.findUniqueOrThrow({
      where: { id: input.exceptionCaseId },
      select: { updatedAt: true },
    });

    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: current.orderId,
        entityType: "ExceptionCase",
        entityId: input.exceptionCaseId,
        eventType: "exception_case_updated",
        summary: `Exception case ${current.caseNumber} updated`,
        metadata: {
          previous: { category: current.category, severity: current.severity },
          new: { category: input.category, severity: input.severity },
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
