import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export const MAX_WAREHOUSE_NOTE_LENGTH = 5000;
const DUPLICATE_WINDOW_MS = 5000;

export interface CreateWarehouseNoteInput {
  shopId: string;
  warehousePickJobId: string;
  body: string;
  staffUserId: string;
}

export type CreateWarehouseNoteResult =
  | { outcome: "created"; noteId: string }
  | { outcome: "duplicate"; noteId: string }
  | { outcome: "rejected"; reason: string };

// Mirrors ProductionNote's policy — internal only, create-only (no edit/
// delete), scoped to the job only this milestone (simpler than production's
// job-or-task duality — items don't need their own note thread).
export async function createWarehouseNote(
  input: CreateWarehouseNoteInput,
): Promise<CreateWarehouseNoteResult> {
  const job = await db.warehousePickJob.findFirst({
    where: { id: input.warehousePickJobId, shopId: input.shopId },
    select: { orderId: true },
  });
  if (!job) {
    return { outcome: "rejected", reason: "Warehouse pick job not found." };
  }

  const trimmedBody = input.body.trim();
  if (!trimmedBody) {
    return { outcome: "rejected", reason: "A note cannot be empty." };
  }
  if (trimmedBody.length > MAX_WAREHOUSE_NOTE_LENGTH) {
    return {
      outcome: "rejected",
      reason: `Notes can't be longer than ${MAX_WAREHOUSE_NOTE_LENGTH} characters.`,
    };
  }

  const recentDuplicate = await db.warehouseNote.findFirst({
    where: {
      warehousePickJobId: input.warehousePickJobId,
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
    const note = await tx.warehouseNote.create({
      data: {
        warehousePickJobId: input.warehousePickJobId,
        authorStaffId: input.staffUserId,
        body: trimmedBody,
      },
    });
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: job.orderId,
        entityType: "WarehousePickJob",
        entityId: input.warehousePickJobId,
        eventType: "warehouse_note_added",
        summary: "Internal note added to warehouse pick job",
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return note;
  });

  return { outcome: "created", noteId: created.id };
}
