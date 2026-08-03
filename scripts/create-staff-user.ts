// One-off tool: creates a new staff account and assigns it a role. There is
// no in-app staff-management UI yet — this mirrors the same
// create-then-print-password-once pattern as prisma/seed.ts's admin account
// and scripts/reset-admin-password.ts.
//
// Usage:
//   npm run db:create-staff -- "paul@justshear.com" "Paul" MANAGER

import { db } from "../app/lib/db.server";
import { hashPassword } from "../app/auth/password.server";

const VALID_ROLES = ["ADMINISTRATOR", "MANAGER", "ARTWORK_STAFF", "PRINT_STAFF", "PACKING_STAFF"];

function generatePassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

async function main() {
  const [email, name, roleName] = process.argv.slice(2);
  if (!email || !name || !roleName) {
    console.error('Usage: npm run db:create-staff -- "email@example.com" "Full Name" ROLE_NAME');
    console.error(`Valid roles: ${VALID_ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (!VALID_ROLES.includes(roleName)) {
    console.error(`Unknown role "${roleName}". Valid roles: ${VALID_ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const shop = await db.shop.findFirstOrThrow();

  const role = await db.role.findUniqueOrThrow({
    where: { shopId_name: { shopId: shop.id, name: roleName } },
  });

  const existing = await db.staffUser.findUnique({
    where: { shopId_email: { shopId: shop.id, email } },
  });
  if (existing) {
    throw new Error(
      `A staff user with email "${email}" already exists — use scripts/reset-admin-password.ts's pattern (or the app once staff-management UI exists) to reset a password instead of creating a duplicate.`,
    );
  }

  const password = generatePassword();
  const staffUser = await db.staffUser.create({
    data: {
      shopId: shop.id,
      email,
      name,
      passwordHash: await hashPassword(password),
    },
  });

  await db.staffRole.create({
    data: { staffUserId: staffUser.id, roleId: role.id },
  });

  console.log(`Created staff user "${email}" (${name}) with role ${roleName}.`);
  console.log(`Password (shown once, never stored): ${password}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
