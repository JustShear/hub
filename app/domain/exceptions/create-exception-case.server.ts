import { ActorType, type ExceptionCaseCategory, type ExceptionCaseInitiator } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isUniqueConstraintViolation } from "~/lib/prisma-errors";

const MAX_CASE_NUMBER_ATTEMPTS = 5;

export interface CreateExceptionCaseInput {
  shopId: string;
  orderId: string;
  orderLineId: string | null;
  category: ExceptionCaseCategory;
  initiatedBy: ExceptionCaseInitiator;
  summary: string;
  customerNote: string | null;
  staffUserId: string;
}

export type CreateExceptionCaseResult =
  | { outcome: "created"; exceptionCaseId: string; caseNumber: number }
  | { outcome: "rejected"; reason: string };

export async function createExceptionCase(
  input: CreateExceptionCaseInput,
): Promise<CreateExceptionCaseResult> {
  const trimmedSummary = input.summary.trim();
  if (!trimmedSummary) {
    return { outcome: "rejected", reason: "A summary of what happened is required." };
  }

  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  if (input.orderLineId) {
    const line = await db.shopifyOrderLine.findFirst({
      where: { id: input.orderLineId, orderId: input.orderId },
    });
    if (!line) {
      return { outcome: "rejected", reason: "That order line doesn't belong to this order." };
    }
  }

  // The @@unique([orderId, caseNumber]) constraint is the real concurrency
  // guard: two simultaneous requests can both read the same "latest" case
  // number and both attempt the next one, but only one INSERT can win — the
  // loser retries with a freshly-read number, mirroring createExportBatch's
  // own batchNumber retry loop.
  for (let attempt = 0; attempt < MAX_CASE_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const latest = await tx.exceptionCase.findFirst({
          where: { orderId: input.orderId },
          orderBy: { caseNumber: "desc" },
        });
        const caseNumber = (latest?.caseNumber ?? 0) + 1;

        const created = await tx.exceptionCase.create({
          data: {
            shopId: input.shopId,
            orderId: input.orderId,
            orderLineId: input.orderLineId,
            caseNumber,
            category: input.category,
            initiatedBy: input.initiatedBy,
            summary: trimmedSummary,
            customerNote: input.customerNote,
            createdByStaffId: input.staffUserId,
          },
        });

        await tx.activityEvent.create({
          data: {
            shopId: input.shopId,
            orderId: input.orderId,
            entityType: "ExceptionCase",
            entityId: created.id,
            eventType: "exception_case_created",
            summary: `Exception case ${caseNumber} reported (${input.category.toLowerCase().replaceAll("_", " ")})`,
            metadata: { category: input.category, initiatedBy: input.initiatedBy },
            actorStaffId: input.staffUserId,
            actorType: ActorType.STAFF,
          },
        });

        return { outcome: "created" as const, exceptionCaseId: created.id, caseNumber };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error) && attempt < MAX_CASE_NUMBER_ATTEMPTS - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to allocate an exception case number after multiple attempts.");
}
