import { ActorType, NoteVisibility } from "@prisma/client";
import { db } from "~/lib/db.server";

export const MAX_NOTE_LENGTH = 5000;
const DUPLICATE_WINDOW_MS = 5000;

export type AddNoteResult =
  | { outcome: "created"; noteId: string }
  | { outcome: "duplicate"; noteId: string }
  | { outcome: "rejected"; reason: string };

export interface AddNoteInput {
  shopId: string;
  orderId: string;
  body: string;
  staffUserId: string;
}

// Notes are internal-only in this milestone (NoteVisibility.INTERNAL) and
// create-only — OrderNote has no "edited"/"deletedAt" columns yet, so
// editing/removal are deferred (documented in docs/development.md) rather
// than built against a model that isn't ready for them.
//
// Content is never interpreted as HTML: components render `note.body` as
// plain JSX text, which React escapes automatically — there is no
// dangerouslySetInnerHTML anywhere in the note-rendering path, so no
// separate sanitisation step is needed at write time.
export async function addOrderNote(input: AddNoteInput): Promise<AddNoteResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    select: { id: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }

  const trimmedBody = input.body.trim();
  if (!trimmedBody) {
    return { outcome: "rejected", reason: "A note cannot be empty." };
  }
  if (trimmedBody.length > MAX_NOTE_LENGTH) {
    return {
      outcome: "rejected",
      reason: `Notes can't be longer than ${MAX_NOTE_LENGTH} characters.`,
    };
  }

  // A simple double-submit guard (e.g. a double click resubmitting the same
  // form) — not a full request-id idempotency system, but effective given
  // notes are created through exactly one form.
  const recentDuplicate = await db.orderNote.findFirst({
    where: {
      orderId: input.orderId,
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
    const note = await tx.orderNote.create({
      data: {
        orderId: input.orderId,
        authorStaffId: input.staffUserId,
        body: trimmedBody,
        visibility: NoteVisibility.INTERNAL,
      },
    });
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: input.orderId,
        entityType: "OrderNote",
        entityId: note.id,
        eventType: "internal_note_added",
        summary: "Internal note added",
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return note;
  });

  return { outcome: "created", noteId: created.id };
}
