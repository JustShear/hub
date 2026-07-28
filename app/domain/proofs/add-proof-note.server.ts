import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export const MAX_PROOF_NOTE_LENGTH = 5000;
const DUPLICATE_WINDOW_MS = 5000;

export type AddProofNoteScope =
  { kind: "group"; proofGroupId: string } | { kind: "version"; proofVersionId: string };

export interface AddProofNoteInput {
  shopId: string;
  scope: AddProofNoteScope;
  body: string;
  staffUserId: string;
}

export type AddProofNoteResult =
  | { outcome: "created"; noteId: string }
  | { outcome: "duplicate"; noteId: string }
  | { outcome: "rejected"; reason: string };

// Scoped to exactly one of a proof group or a specific proof version — same
// create-only, internal-only, never-rendered-as-HTML shape as OrderNote
// (Milestone 07), just at proof scope instead of order scope.
export async function addProofNote(input: AddProofNoteInput): Promise<AddProofNoteResult> {
  let orderId: string;
  let proofGroupId: string | null = null;
  let proofVersionId: string | null = null;

  if (input.scope.kind === "group") {
    const group = await db.proofGroup.findFirst({
      where: { id: input.scope.proofGroupId, order: { shopId: input.shopId } },
      select: { orderId: true },
    });
    if (!group) {
      return { outcome: "rejected", reason: "Proof group not found." };
    }
    orderId = group.orderId;
    proofGroupId = input.scope.proofGroupId;
  } else {
    const version = await db.proofVersion.findFirst({
      where: { id: input.scope.proofVersionId, proofGroup: { order: { shopId: input.shopId } } },
      select: { proofGroup: { select: { orderId: true } } },
    });
    if (!version) {
      return { outcome: "rejected", reason: "Proof version not found." };
    }
    orderId = version.proofGroup.orderId;
    proofVersionId = input.scope.proofVersionId;
  }

  const trimmedBody = input.body.trim();
  if (!trimmedBody) {
    return { outcome: "rejected", reason: "A note cannot be empty." };
  }
  if (trimmedBody.length > MAX_PROOF_NOTE_LENGTH) {
    return {
      outcome: "rejected",
      reason: `Notes can't be longer than ${MAX_PROOF_NOTE_LENGTH} characters.`,
    };
  }

  const recentDuplicate = await db.proofNote.findFirst({
    where: {
      proofGroupId,
      proofVersionId,
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
    const note = await tx.proofNote.create({
      data: { proofGroupId, proofVersionId, authorStaffId: input.staffUserId, body: trimmedBody },
    });
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId,
        entityType: proofVersionId ? "ProofVersion" : "ProofGroup",
        entityId: proofVersionId ?? proofGroupId ?? "",
        eventType: "proof_note_added",
        summary: proofVersionId
          ? "Internal note added to proof version"
          : "Internal note added to proof group",
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return note;
  });

  return { outcome: "created", noteId: created.id };
}
