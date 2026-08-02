import { randomUUID } from "node:crypto";
import { ActorType, type ExceptionResolutionType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isTerminalCaseStatus } from "~/domain/exceptions/case-transitions";
import { validateResolutionInput } from "~/domain/exceptions/resolution-validation";
import { createExportBatch } from "~/domain/production/create-export-batch.server";

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
  | { outcome: "resolved"; resolutionId: string; exportBatchId: string | null }
  | { outcome: "rejected"; reason: string; issues?: string[] };

/**
 * The centrepiece of Milestone 14: records how an exception case was
 * resolved. CREDIT/REFUND are record-only (no Shopify money movement — staff
 * execute the actual refund/credit themselves); REPRINT/EXCHANGE both reuse
 * the *existing* createExportBatch/reExportBatch mechanism (Milestone 10) to
 * produce a real new ExportBatch -> ProductionJob/ProductionTask chain,
 * rather than a second, disconnected reprint-tracking mechanism. See
 * ADR-0010.
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
  let exportBatchId: string | null = null;

  // Deliberately called *before* the resolution/case-update transaction
  // below, never nested inside it — createExportBatch does its own file
  // I/O and DB transaction internally, and this codebase never holds a
  // transaction open across external work (same principle as freight's
  // reserve-then-finalise shape). A retry after this call succeeds but
  // before the case is marked RESOLVED could in principle create a second
  // export batch — an accepted, narrow risk window, same class as freight's
  // own documented one.
  if (input.resolutionType === "REPRINT" || input.resolutionType === "EXCHANGE") {
    if (!input.proofGroupId) {
      return { outcome: "rejected", reason: "A proof group is required." };
    }
    const exportResult = await createExportBatch({
      shopId: input.shopId,
      orderId: current.orderId,
      proofGroupIds: [input.proofGroupId],
      destination: null,
      staffUserId: input.staffUserId,
      idempotencyKey: randomUUID(),
      reexportReason: trimmedReason,
    });
    if (exportResult.outcome === "rejected") {
      return { outcome: "rejected", reason: exportResult.reason, issues: exportResult.issues };
    }
    exportBatchId = exportResult.exportBatchId;
  }

  const resolutionId = await db.$transaction(async (tx) => {
    const created = await tx.exceptionCaseResolution.create({
      data: {
        exceptionCaseId: input.exceptionCaseId,
        resolutionType: input.resolutionType,
        reason: trimmedReason,
        amount: input.amount,
        currencyCode: input.currencyCode,
        exportBatchId,
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
          exportBatchId,
        },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });

    return created.id;
  });

  return { outcome: "resolved", resolutionId, exportBatchId };
}
