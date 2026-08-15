import { Theme } from "@prisma/client";
import type { Route } from "./+types/profile.actions";
import { requireStaffUser } from "~/auth/staff-session.server";
import { updateStaffThemePreference } from "~/domain/staff/update-theme-preference.server";

const THEME_VALUES = new Set<string>(Object.values(Theme));

// Action-only resource route — every staff self-service profile mutation
// goes through here, matching notifications.actions.tsx's
// one-route-many-intents convention. No permission gate beyond being signed
// in: every mutation here only ever touches the caller's own StaffUser row.
export async function action({ request }: Route.ActionArgs) {
  const staffUser = await requireStaffUser(request);

  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "setTheme") {
    const theme = formData.get("theme");
    if (typeof theme !== "string" || !THEME_VALUES.has(theme)) {
      return { intent, ok: false, error: "Unknown theme." };
    }
    await updateStaffThemePreference(staffUser.id, theme as Theme);
    return { intent, ok: true };
  }

  return { intent: "unknown", ok: false, error: "Unknown action." };
}
