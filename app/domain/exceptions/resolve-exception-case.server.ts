import { ActorType, type ExceptionResolutionType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isTerminalCaseStatus } from "~/domain/exceptions/case-transitions";
import { validateResolutionInput } from "~/domain/exceptions/resolution-validation";

export interface ResolveExceptionCaseInput {
  shopId: string;
  exceptionCaseId: string;
  resolutionType: ExceptionResolutionType;
  reason: string;
  amount: number | null;
  currencyCode: string | null;
  /** Required only for REPRINT/EXCHANGE — the group being reprinted/exchanged. */
  proofGroupId: string | null;
  staffUserId: string;
}

export type ResolveExceptionCaseResult =
  | { outcome: "resolved"; resolutionId: string }
  | { outcome: "rejected"; reason: string; issues?: string[] };

/**
 * The centrepiece of Milestone 14: records how an exception case was
 * resolved. All resolution types are record-only — CREDIT/REFUND (staff
 * execute the actual refund/credit themselves) and REPRINT/EXCHANGE alike.
 * REPRINT/EXCHANGE used to auto-create a real export batch/production job
 * (Milestone 10/11); that mechanism was removed (see
 * docs/decisions on removing Production Artwork), so for now these two
 * types just record the decision, same as DENIED — a real reprint/exchange
 * workflow is deferred until this flow is actually tested. See ADR-0010.
 */
export async function resolveExceptionCase(
  input: ResolveExceptionCaseInput,
): Promise<ResolveExceptionCaseResult> {
  const validation = validateResolutionInput({
    resolutionType: input.resolutionType,
    reason: input.reason,
    amount: input.amount,
    proofGroupId: input.proofGroupId,
  });
  if (!validation.valid) {
    return { outcome: "rejected", reason: validation.reason ?? "Invalid resolution." };
  }

  const current = await db.exceptionCase.findFirst({
    where: { id: input.exceptionCaseId, shopId: input.shopId },
  });
  if (!current) {
    return { outcome: "rejected", reason: "Exception case not found." };
  }
  if (isTerminalCaseStatus(current.status)) {
    return {
      outcome: "rejected",
      reason: "This exception case has already reached a terminal status.",
    };
  }

  const trimmedReason = input.reason.trim();

  const resolutionId = await db.$transaction(async (tx) => {
    const created = await tx.exceptionCaseResolution.create({
      data: {
        exceptionCaseId: input.exceptionCaseId,
        resolutionType: input.resolutionType,
        reason: trimmedReason,
        amount: input.amount,
        currencyCode: input.currencyCode,
        decidedByStaffId: input.staffUserId,
      },
    });

    const updateResult = await tx.exceptionCase.updateMany({
      where: { id: input.exceptionCaseId, status: current.status },
      data: { status: "RESOLVED", resolvedAt: new Date() },
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
        eventType: "exception_case_resolved",
        summary: `Exception case ${current.caseNumber} resolved (${input.resolutionType.toLowerCase()})`,
        metadata: {
          resolutionType: input.resolutionType,
          reason: trimmedReason,
          amount: input.amount,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    return created.id;
  });

  return { outcome: "resolved", resolutionId };
}
