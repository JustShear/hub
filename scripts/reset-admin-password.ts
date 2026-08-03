// Recovery tool: resets a staff account's password. prisma/seed.ts and
// scripts/create-staff-user.ts each print a generated password once, at
// creation time only, and never store it anywhere — by design, so a
// committed well-known password can't let anyone with the repo sign in to a
// real deployment. If that one-time password is lost (or needs rotating),
// this is the supported way to regain access, rather than deleting and
// recreating the account.
//
// Usage:
//   npm run db:reset-admin-password
//   npm run db:reset-admin-password -- "paul@justshear.com"
//   DEV_ADMIN_PASSWORD="a password you control" npm run db:reset-admin-password

import { randomBytes } from "node:crypto";
import { db } from "../app/lib/db.server";
import { hashPassword } from "../app/auth/password.server";

async function main() {
  const email = process.argv[2] ?? "admin@justshear.com";
  const shop = await db.shop.findFirstOrThrow();
  const staffUser = await db.staffUser.findUnique({
    where: { shopId_email: { shopId: shop.id, email } },
  });
  if (!staffUser) {
    throw new Error(`No staff user "${email}" exists yet for this shop.`);
  }

  const password = process.env.DEV_ADMIN_PASSWORD ?? randomBytes(18).toString("base64url");
  await db.staffUser.update({
    where: { id: staffUser.id },
    data: { passwordHash: await hashPassword(password) },
  });

  console.log(`Password reset for "${email}".`);
  console.log(`New password (shown once, never stored): ${password}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
