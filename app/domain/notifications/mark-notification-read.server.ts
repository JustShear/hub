import { db } from "~/lib/db.server";

export interface MarkNotificationReadInput {
  staffUserId: string;
  notificationId: string;
}

export type MarkNotificationReadResult =
  { outcome: "marked" } | { outcome: "rejected"; reason: string };

// Scoped by staffUserId in the where clause — never trust the id alone, a
// notification belongs to exactly one staff user and must never be
// readable/writable cross-user.
export async function markNotificationRead(
  input: MarkNotificationReadInput,
): Promise<MarkNotificationReadResult> {
  const result = await db.notification.updateMany({
    where: { id: input.notificationId, staffUserId: input.staffUserId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await db.notification.findFirst({
      where: { id: input.notificationId, staffUserId: input.staffUserId },
    });
    if (!exists) {
      return { outcome: "rejected", reason: "Notification not found." };
    }
  }
  return { outcome: "marked" };
}

export async function markAllNotificationsRead(staffUserId: string): Promise<void> {
  await db.notification.updateMany({
    where: { staffUserId, readAt: null },
    data: { readAt: new Date() },
  });
}
