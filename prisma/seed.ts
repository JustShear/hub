import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../app/auth/password.server";

const db = new PrismaClient();

// Never a fixed default — a committed, well-known password would let anyone
// with the repo sign in to any deployment seeded from it. DEV_ADMIN_PASSWORD
// lets a developer choose one; otherwise a random one is generated and
// printed to the console once, at creation time only.
function resolveAdminPassword(): string {
  const fromEnv = process.env.DEV_ADMIN_PASSWORD;
  if (fromEnv) {
    return fromEnv;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed an admin account in production without an explicit " +
        "DEV_ADMIN_PASSWORD. Set it to a password you control, or provision the " +
        "admin account through a deliberate, out-of-band process instead.",
    );
  }

  return randomBytes(18).toString("base64url");
}

// Permission catalog — infrastructure only. Keys are coarse-grained on
// purpose: no feature screens exist yet for these to gate, so this proves
// the RBAC plumbing (Role -> RolePermission -> Permission) works without
// inventing permissions for functionality that isn't built.
const PERMISSIONS = [
  { key: "board.view", description: "View the Kanban board" },
  { key: "board.manage", description: "Move orders between workflow states on the Kanban board" },
  { key: "orders.view", description: "View order details" },
  {
    key: "orders.assignment.update",
    description: "Change which staff member an order is assigned to",
  },
  { key: "orders.priority.update", description: "Change an order's internal priority" },
  {
    key: "orders.due_dates.update",
    description: "Add, change or clear an order's internal due dates",
  },
  // Superseded for group/version CRUD by the more granular proof_groups.*/
  // proof_versions.* keys below (Milestone 08) — kept, unused by any check
  // going forward, since proof.send/proof.export still gate the later
  // customer-sending and export-for-print milestones.
  { key: "proof.create", description: "Create proof groups and versions" },
  { key: "proof.send", description: "Send a proof to a customer" },
  { key: "proof.export", description: "Mark an approved proof exported for print" },
  { key: "proof_groups.view", description: "View proof groups on an order" },
  { key: "proof_groups.create", description: "Create a new proof group on an order" },
  {
    key: "proof_groups.update",
    description: "Edit a proof group's name, description, method, placement, priority or due date",
  },
  { key: "proof_groups.cancel", description: "Cancel a proof group" },
  {
    key: "proof_groups.requirement.update",
    description: "Set a proof group's proof-required / no-proof-required / undetermined decision",
  },
  { key: "proof_versions.view", description: "View proof versions within a proof group" },
  { key: "proof_versions.create", description: "Create a new proof version within a proof group" },
  { key: "proof_versions.upload", description: "Upload a proof file to a proof version" },
  {
    key: "proof_versions.status.update",
    description: "Mark a proof version ready to send, superseded, or cancelled",
  },
  { key: "proof_artwork.assign", description: "Assign a proof group to an artwork staff member" },
  {
    key: "proof_artwork.notes.create",
    description: "Add an internal note to a proof group or version",
  },
  {
    key: "proof_overrides.create",
    description:
      "Perform a reasoned manual override on a proof group or version (e.g. reopening a no-proof-required group)",
  },
  { key: "notes.internal.view", description: "View staff-only internal notes" },
  { key: "notes.internal.create", description: "Add staff-only internal notes" },
  { key: "integrations.view", description: "View the integration failure queue" },
  { key: "integrations.manage", description: "Retry, assign or resolve integration failures" },
  { key: "overrides.create", description: "Perform a reasoned manual override" },
  {
    key: "overrides.manager_approve",
    description: "Approve overrides that require manager sign-off",
  },
  { key: "settings.manage", description: "Manage shop settings, roles and templates" },
  { key: "reports.view", description: "View reporting and metrics" },
  { key: "staff.manage", description: "Create and manage staff accounts" },
  {
    key: "raw_data.view",
    description: "View raw Shopify payloads and line properties (developer-only inspector)",
  },
] as const;

// SRS Section 6 — Users, Roles and Permissions. "Customer" isn't a StaffUser
// role, so it's excluded here.
const ROLE_PERMISSIONS: Record<string, readonly (typeof PERMISSIONS)[number]["key"][]> = {
  ADMINISTRATOR: PERMISSIONS.map((p) => p.key),
  MANAGER: [
    "board.view",
    "board.manage",
    "orders.view",
    "orders.assignment.update",
    "orders.priority.update",
    "orders.due_dates.update",
    "proof.create",
    "proof.send",
    "proof.export",
    "proof_groups.view",
    "proof_groups.create",
    "proof_groups.update",
    "proof_groups.cancel",
    "proof_groups.requirement.update",
    "proof_versions.view",
    "proof_versions.create",
    "proof_versions.upload",
    "proof_versions.status.update",
    "proof_artwork.assign",
    "proof_artwork.notes.create",
    "proof_overrides.create",
    "notes.internal.view",
    "notes.internal.create",
    "integrations.view",
    "integrations.manage",
    "overrides.create",
    "overrides.manager_approve",
    "reports.view",
  ],
  ARTWORK_STAFF: [
    "board.view",
    "board.manage",
    "orders.view",
    "orders.assignment.update",
    "orders.priority.update",
    "orders.due_dates.update",
    "proof.create",
    "proof.send",
    "proof.export",
    "proof_groups.view",
    "proof_groups.create",
    "proof_groups.update",
    "proof_groups.cancel",
    "proof_groups.requirement.update",
    "proof_versions.view",
    "proof_versions.create",
    "proof_versions.upload",
    "proof_versions.status.update",
    "proof_artwork.assign",
    "proof_artwork.notes.create",
    "proof_overrides.create",
    "notes.internal.view",
    "notes.internal.create",
    "overrides.create",
  ],
  PRINT_STAFF: ["board.view", "orders.view", "proof_groups.view", "proof_versions.view"],
  PACKING_STAFF: ["board.view"],
};

async function main() {
  const shop = await db.shop.upsert({
    where: { shopifyDomain: "just-shear-dev.myshopify.com" },
    update: {},
    create: {
      shopifyDomain: "just-shear-dev.myshopify.com",
      shopifyShopGid: "gid://shopify/Shop/0000000000",
      adminApiToken: "placeholder-set-real-token-in-env-managed-config",
      scopes: "read_orders,read_products,write_orders",
    },
  });

  for (const permission of PERMISSIONS) {
    await db.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
  }

  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await db.role.upsert({
      where: { shopId_name: { shopId: shop.id, name: roleName } },
      update: {},
      create: { shopId: shop.id, name: roleName },
    });

    for (const key of permissionKeys) {
      const permission = await db.permission.findUniqueOrThrow({ where: { key } });
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const adminEmail = "admin@justshear.com";
  const adminRole = await db.role.findUniqueOrThrow({
    where: { shopId_name: { shopId: shop.id, name: "ADMINISTRATOR" } },
  });

  let admin = await db.staffUser.findUnique({
    where: { shopId_email: { shopId: shop.id, email: adminEmail } },
  });

  let generatedPassword: string | null = null;

  if (!admin) {
    const password = resolveAdminPassword();
    generatedPassword = password;
    admin = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: adminEmail,
        name: "Administrator",
        passwordHash: await hashPassword(password),
      },
    });
  }

  await db.staffRole.upsert({
    where: { staffUserId_roleId: { staffUserId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { staffUserId: admin.id, roleId: adminRole.id },
  });

  console.log(`Seeded shop "${shop.shopifyDomain}", ${PERMISSIONS.length} permissions, `);
  console.log(`${Object.keys(ROLE_PERMISSIONS).length} roles, and admin user "${adminEmail}".`);
  if (generatedPassword) {
    console.log(`Admin password (shown once, never stored): ${generatedPassword}`);
  } else {
    console.log("Admin account already existed — password unchanged.");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
