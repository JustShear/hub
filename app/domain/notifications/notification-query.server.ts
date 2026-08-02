import { db } from "~/lib/db.server";

const RECENT_NOTIFICATION_LIMIT = 20;

export async function loadRecentNotifications(staffUserId: string) {
  return db.notification.findMany({
    where: { staffUserId },
    orderBy: { createdAt: "desc" },
    take: RECENT_NOTIFICATION_LIMIT,
  });
}

export async function countUnreadNotifications(staffUserId: string): Promise<number> {
  return db.notification.count({ where: { staffUserId, readAt: null } });
}
