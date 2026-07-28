import { db } from "~/lib/db.server";
import { verifyPassword } from "~/auth/password.server";

// Kept separate from staff-session.server.ts so credential verification is
// testable against the real database without needing a Request/Response.
export async function authenticateStaffUser(
  shopId: string,
  email: string,
  password: string,
): Promise<{ id: string } | null> {
  const staffUser = await db.staffUser.findUnique({
    where: { shopId_email: { shopId, email } },
  });

  if (!staffUser?.isActive) {
    return null;
  }

  const isValid = await verifyPassword(password, staffUser.passwordHash);
  if (!isValid) {
    return null;
  }

  return { id: staffUser.id };
}
