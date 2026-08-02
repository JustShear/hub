import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export const MAX_PRODUCTION_NOTE_LENGTH = 5000;
const DUPLICATE_WINDOW_MS = 5000;

export type AddProductionNoteScope =
  { kind: "job"; productionJobId: string } | { kind: "task"; productionTaskId: string };

export interface AddProductionNoteInput {
  shopId: string;
  scope: AddProductionNoteScope;
  body: string;
  staffUserId: string;
}

export type AddProductionNoteResult =
  | { outcome: "created"; noteId: string }
  | { outcome: "duplicate"; noteId: string }
  | { outcome: "rejected"; reason: string };

// Mirrors ProofNote/OrderNote's exact shape and policy — internal only,
// create-only (no edit/delete), scoped to exactly one of a job or a task,
// never rendered as HTML.
export async function addProductionNote(
  input: AddProductionNoteInput,
): Promise<AddProductionNoteResult> {
  let orderId: string;
  let productionJobId: string | null = null;
  let productionTaskId: string | null = null;

  if (input.scope.kind === "job") {
    const job = await db.productionJob.findFirst({
      where: { id: input.scope.productionJobId, shopId: input.shopId },
      select: { orderId: true },
    });
    if (!job) {
      return { outcome: "rejected", reason: "Production job not found." };
    }
    orderId = job.orderId;
    productionJobId = input.scope.productionJobId;
  } else {
    const task = await db.productionTask.findFirst({
      where: { id: input.scope.productionTaskId, productionJob: { shopId: input.shopId } },
      select: { productionJob: { select: { orderId: true } } },
    });
    if (!task) {
      return { outcome: "rejected", reason: "Production task not found." };
    }
    orderId = task.productionJob.orderId;
    productionTaskId = input.scope.productionTaskId;
  }

  const trimmedBody = input.body.trim();
  if (!trimmedBody) {
    return { outcome: "rejected", reason: "A note cannot be empty." };
  }
  if (trimmedBody.length > MAX_PRODUCTION_NOTE_LENGTH) {
    return {
      outcome: "rejected",
      reason: `Notes can't be longer than ${MAX_PRODUCTION_NOTE_LENGTH} characters.`,
    };
  }

  const recentDuplicate = await db.productionNote.findFirst({
    where: {
      productionJobId,
      productionTaskId,
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
    const note = await tx.productionNote.create({
      data: {
        productionJobId,
        productionTaskId,
        authorStaffId: input.staffUserId,
        body: trimmedBody,
      },
    });
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId,
        entityType: productionTaskId ? "ProductionTask" : "ProductionJob",
        entityId: productionTaskId ?? productionJobId ?? "",
        eventType: "production_note_added",
        summary: productionTaskId
          ? "Internal note added to production task"
          : "Internal note added to production job",
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return note;
  });

  return { outcome: "created", noteId: created.id };
}
