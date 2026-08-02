import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import { isTerminalCaseStatus } from "~/domain/exceptions/case-transitions";

export interface RecordReturnLabelInput {
  shopId: string;
  exceptionCaseId: string;
  note: string;
  staffUserId: string;
}

export type RecordReturnLabelResult =
  { outcome: "recorded" } | { outcome: "rejected"; reason: string };

// Manual/external this milestone — no carrier API call, just the fact that
// a return label was provided (e.g. via a carrier's own portal), plus a
// free-text note (carrier, tracking number, etc.). See ADR-0010.
export async function recordReturnLabel(
  input: RecordReturnLabelInput,
): Promise<RecordReturnLabelResult> {
  const trimmedNote = input.note.trim();
  if (!trimmedNote) {
    return { outcome: "rejected", reason: "A note describing the return label is required." };
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

  await db.$transaction(async (tx) => {
    await tx.exceptionCase.update({
      where: { id: input.exceptionCaseId },
      data: {
        returnLabelProvidedAt: new Date(),
        returnLabelNote: trimmedNote,
        returnLabelProvidedByStaffId: input.staffUserId,
      },
    });
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: current.orderId,
        entityType: "ExceptionCase",
        entityId: input.exceptionCaseId,
        eventType: "exception_case_return_label_recorded",
        summary: `Return label recorded for exception case ${current.caseNumber}`,
        metadata: { note: trimmedNote },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
  });

  return { outcome: "recorded" };
}
