import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

export interface SuppressProofReminderInput {
  shopId: string;
  proofRequestId: string;
  reason: string;
  staffUserId: string;
}

export type SuppressProofReminderResult =
  | { outcome: "suppressed" }
  | { outcome: "already_there" }
  | { outcome: "rejected"; reason: string };

/** Suppression only prevents the automatic reminder — it never revokes the proof request itself. */
export async function suppressProofReminder(
  input: SuppressProofReminderInput,
): Promise<SuppressProofReminderResult> {
  const reminder = await db.proofReminder.findFirst({
    where: { proofRequestId: input.proofRequestId, proofRequest: { shopId: input.shopId } },
    include: { proofRequest: true },
  });
  if (!reminder) {
    return { outcome: "rejected", reason: "No reminder is scheduled for this proof request." };
  }
  if (reminder.suppressed) {
    return { outcome: "already_there" };
  }
  if (reminder.sentAt) {
    return { outcome: "rejected", reason: "The reminder has already been sent." };
  }
  const reason = input.reason.trim();
  if (!reason) {
    return { outcome: "rejected", reason: "A reason is required to suppress the reminder." };
  }

  const result = await db.$transaction(async (tx) => {
    const updateResult = await tx.proofReminder.updateMany({
      where: { id: reminder.id, suppressed: false, sentAt: null },
      data: { suppressed: true, suppressedReason: reason, suppressedByStaffId: input.staffUserId },
    });
    if (updateResult.count === 0) {
      return { suppressed: false as const };
    }
    await tx.activityEvent.create({
      data: {
        shopId: input.shopId,
        orderId: reminder.proofRequest.orderId,
        entityType: "ProofRequest",
        entityId: reminder.proofRequest.id,
        eventType: "proof_reminder_suppressed",
        summary: `Automatic reminder suppressed: ${reason}`,
        metadata: { reason },
        actorStaffId: input.staffUserId,
        actorType: ActorType.STAFF,
      },
    });
    return { suppressed: true as const };
  });

  return result.suppressed ? { outcome: "suppressed" } : { outcome: "already_there" };
}
