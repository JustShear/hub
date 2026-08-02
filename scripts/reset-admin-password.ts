// Development-only recovery tool: resets the seeded admin account's
// password. prisma/seed.ts prints the admin password once, at creation
// time only, and never stores it anywhere — by design, so a committed
// well-known password can't let anyone with the repo sign in to a real
// deployment. If that one-time password is lost, this is the supported way
// to regain access, rather than deleting and recreating the account.
//
// Usage:
//   npm run db:reset-admin-password
//   DEV_ADMIN_PASSWORD="a password you control" npm run db:reset-admin-password

import { randomBytes } from "node:crypto";
import { db } from "../app/lib/db.server";
import { hashPassword } from "../app/auth/password.server";

async function main() {
  const adminEmail = "admin@justshear.com";
  const shop = await db.shop.findFirstOrThrow();
  const admin = await db.staffUser.findUnique({
    where: { shopId_email: { shopId: shop.id, email: adminEmail } },
  });
  if (!admin) {
    throw new Error(
      `No staff user "${adminEmail}" exists yet for this shop — run "npm run db:seed" first.`,
    );
  }

  const password = process.env.DEV_ADMIN_PASSWORD ?? randomBytes(18).toString("base64url");
  await db.staffUser.update({
    where: { id: admin.id },
    data: { passwordHash: await hashPassword(password) },
  });

  console.log(`Password reset for "${adminEmail}".`);
  console.log(`New admin password (shown once, never stored): ${password}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
