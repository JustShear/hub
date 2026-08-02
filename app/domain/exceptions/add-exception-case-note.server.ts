import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export const MAX_EXCEPTION_NOTE_LENGTH = 5000;
const DUPLICATE_WINDOW_MS = 5000;

export interface AddExceptionCaseNoteInput {
  shopId: string;
  exceptionCaseId: string;
  body: string;
  staffUserId: string;
}

export type AddExceptionCaseNoteResult =
  | { outcome: "created"; noteId: string }
  | { outcome: "duplicate"; noteId: string }
  | { outcome: "rejected"; reason: string };

// Create-only, internal-only, never-rendered-as-HTML — same shape as
// ProofNote/ProductionNote/WarehouseNote, just at exception-case scope.
export async function addExceptionCaseNote(
  input: AddExceptionCaseNoteInput,
): Promise<AddExceptionCaseNoteResult> {
  const exceptionCase = await db.exceptionCase.findFirst({
    where: { id: input.exceptionCaseId, shopId: input.shopId },
    select: { orderId: true },
  });
  if (!exceptionCase) {
    return { outcome: "rejected", reason: "Exception case not found." };
  }

  const trimmedBody = input.body.trim();
  if (!trimmedBody) {
    return { outcome: "rejected", reason: "A note cannot be empty." };
  }
  if (trimmedBody.length > MAX_EXCEPTION_NOTE_LENGTH) {
    return {
      outcome: "rejected",
      reason: `Notes can't be longer than ${MAX_EXCEPTION_NOTE_LENGTH} characters.`,
    };
  }

  const recentDuplicate = await db.exceptionCaseNote.findFirst({
    where: {
      exceptionCaseId: input.exceptionCaseId,
      authorStaffId: input.staffUserId,
      body: trimmedBody,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recentDuplicate) {
    return { outcome: "duplicate", noteId: recentDuplicate.id };
  }

  const created = await db.$transaction(async (tx) => {
    const note = await tx.exceptionCaseNote.create({
      data: {
        exceptionCaseId: input.exceptionCaseId,
        authorStaffId: input.staffUserId,
        body: trimmedBody,
      },
    });
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: exceptionCase.orderId,
        entityType: "ExceptionCase",
        entityId: input.exceptionCaseId,
        eventType: "exception_case_note_added",
        summary: "Internal note added to exception case",
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return note;
  });

  return { outcome: "created", noteId: created.id };
}
