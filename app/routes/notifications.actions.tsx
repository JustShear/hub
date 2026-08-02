import type { Route } from "./+types/notifications.actions";
import { requireStaffUser } from "~/auth/staff-session.server";
import { formString } from "~/lib/form-data";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "~/domain/notifications/mark-notification-read.server";

// Action-only resource route (no loader, no component) — every notification
// mutation goes through here, mirroring warehouse.actions.tsx's/
// production.actions.tsx's one-route-many-intents convention. No permission
// gate beyond being signed in: every mutation here is scoped to the caller's
// own staffUserId, never another user's notifications.
export async function action({ request }: Route.ActionArgs) {
  const staffUser = await requireStaffUser(request);

  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "markRead") {
    const result = await markNotificationRead({
      staffUserId: staffUser.id,
      notificationId: formString(formData, "notificationId"),
    });
    if (result.outcome === "rejected") {
      return { intent, ok: false, error: result.reason };
    }
    return { intent, ok: true };
  }

  if (intent === "markAllRead") {
    await markAllNotificationsRead(staffUser.id);
    return { intent, ok: true };
  }

  return { intent: "unknown", ok: false, error: "Unknown action." };
}
