import type { Theme } from "@prisma/client";
import { db } from "~/lib/db.server";

// A personal display preference, not a business fact — unlike
// update-needs-printing.server.ts's order-level flag, this has no audit
// trail (no ActivityEvent): nothing downstream ever needs to explain why a
// staff member's interface looks the way it does.
export async function updateStaffThemePreference(staffUserId: string, theme: Theme): Promise<void> {
  await db.staffUser.update({ where: { id: staffUserId }, data: { theme } });
}
