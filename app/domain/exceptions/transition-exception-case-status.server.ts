import { ActorType, type ExceptionCaseStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { canCancelCase, validateCaseStatusTransition } from "~/domain/exceptions/case-transitions";

export type TransitionExceptionCaseResult =
  { outcome: "transitioned" } | { outcome: "rejected"; reason: string };

async function transitionStatus(params: {
  shopId: string;
  exceptionCaseId: string;
  targetStatus: Exclude<ExceptionCaseStatus, "CANCELLED">;
  eventType: string;
  extraData?: Record<string, unknown>;
  staffUserId: string;
}): Promise<TransitionExceptionCaseResult> {
  const current = await db.exceptionCase.findFirst({
    where: { id: params.exceptionCaseId, shopId: params.shopId },
  });
  if (!current) {
    return { outcome: "rejected", reason: "Exception case not found." };
  }
  const validation = validateCaseStatusTransition(current.status, params.targetStatus);
  if (!validation.allowed) {
    return { outcome: "rejected", reason: validation.reason ?? "This transition isn't allowed." };
  }

  await db.$transaction(async (tx) => {
    const updateResult = await tx.exceptionCase.updateMany({
      where: { id: params.exceptionCaseId, status: current.status },
      data: { status: params.targetStatus, ...params.extraData },
    });
    if (updateResult.count === 0) {
      throw new Error("Exception case status changed concurrently — please retry.");
    }
    await tx.activityEvent.create({
      data: {
        shopId: params.shopId,
        orderId: current.orderId,
        entityType: "ExceptionCase",
        entityId: params.exceptionCaseId,
        eventType: params.eventType,
        summary: `Exception case ${current.caseNumber} moved to ${params.targetStatus.toLowerCase().replaceAll("_", " ")}`,
        metadata: { previousStatus: current.status, newStatus: params.targetStatus },
        actorStaffId: params.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
  });

  return { outcome: "transitioned" };
}

export async function startInvestigation(input: {
  shopId: string;
  exceptionCaseId: string;
  staffUserId: string;
}): Promise<TransitionExceptionCaseResult> {
  return transitionStatus({
    ...input,
    targetStatus: "INVESTIGATING",
    eventType: "exception_case_investigation_started",
    extraData: { investigationStartedAt: new Date() },
  });
}

export async function markAwaitingCustomer(input: {
  shopId: string;
  exceptionCaseId: string;
  staffUserId: string;
}): Promise<TransitionExceptionCaseResult> {
  return transitionStatus({
    ...input,
    targetStatus: "AWAITING_CUSTOMER",
    eventType: "exception_case_awaiting_customer",
  });
}

export async function cancelExceptionCase(input: {
  shopId: string;
  exceptionCaseId: string;
  reason: string;
  staffUserId: string;
}): Promise<TransitionExceptionCaseResult> {
  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    return { outcome: "rejected", reason: "A reason is required to cancel an exception case." };
  }

  const current = await db.exceptionCase.findFirst({
    where: { id: input.exceptionCaseId, shopId: input.shopId },
  });
  if (!current) {
    return { outcome: "rejected", reason: "Exception case not found." };
  }
  const validation = canCancelCase(current.status);
  if (!validation.allowed) {
    return { outcome: "rejected", reason: validation.reason ?? "This case can't be cancelled." };
  }

  await db.$transaction(async (tx) => {
    const updateResult = await tx.exceptionCase.updateMany({
      where: { id: input.exceptionCaseId, status: current.status },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: trimmedReason,
        cancelledByStaffId: input.staffUserId,
      },
    });
    if (updateResult.count === 0) {
      throw new Error("Exception case status changed concurrently — please retry.");
    }
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: current.orderId,
        entityType: "ExceptionCase",
        entityId: input.exceptionCaseId,
        eventType: "exception_case_cancelled",
        summary: `Exception case ${current.caseNumber} cancelled`,
        metadata: { reason: trimmedReason, previousStatus: current.status },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
  });

  return { outcome: "transitioned" };
}
