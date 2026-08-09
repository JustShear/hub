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
  // proof_versions.* keys (Milestone 08) and for customer-sending by
  // proof_requests.* (Milestone 09) — kept, unused by any check going
  // forward.
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
  // Milestone 09 — customer proof requests. The customer portal itself is
  // gated by possession of a secure token, not by any of these; these only
  // gate the internal staff-facing send/view/resend/revoke/override actions.
  {
    key: "proof_requests.create",
    description: "Send a proof request (one or more ready proof groups) to a customer",
  },
  { key: "proof_requests.view", description: "View sent proof requests and their status" },
  {
    key: "proof_requests.resend",
    description: "Resend an existing proof request's email using the same link",
  },
  {
    key: "proof_requests.revoke",
    description: "Revoke an active proof request's customer link",
  },
  {
    key: "proof_responses.view",
    description: "View customer responses, comments and uploaded mark-ups on a proof request",
  },
  {
    key: "proof_responses.override",
    description:
      "Reopen an approved proof version or invalidate a customer approval, with a reason",
  },
  {
    key: "proof_reminders.manage",
    description: "Suppress or view the automatic proof reminder for a proof request",
  },
  // Milestone 12 — Starshipit freight labels. Staff are trusted to trigger
  // this once the order is actually, physically packed — no automated
  // completeness gate (no packing model exists yet — see ADR-0008).
  {
    key: "freight_shipments.view",
    description: "View freight shipments and their tracking/Shopify-sync status for an order",
  },
  {
    key: "freight_shipments.create",
    description: "Create a Starshipit freight shipment and print its label for an order",
  },
  {
    key: "freight_shipments.download",
    description: "Download a generated freight label PDF",
  },
  {
    key: "freight_shipments.cancel",
    description: "Cancel a freight shipment record (does not void the label with the carrier)",
  },
  // Milestone 13 — warehouse picking. A checklist workflow, not real
  // inventory tracking (no SKU/bin on-hand-quantity model exists). Auto-
  // created once an order gains the "Exported for Print" Shopify tag — see
  // ADR-0009.
  {
    key: "warehouse_picks.view",
    description: "View warehouse pick jobs and their pick lists for an order",
  },
  {
    key: "warehouse_picks.assign",
    description: "Assign a warehouse pick job to staff",
  },
  {
    key: "warehouse_picks.record_quantity",
    description: "Record a picked quantity against a warehouse pick item",
  },
  {
    key: "warehouse_picks.mark_short",
    description: "Mark a warehouse pick item as short (unable to fulfil the required quantity)",
  },
  {
    key: "warehouse_picks.handover",
    description: "Hand a completed warehouse pick job over to packing",
  },
  { key: "warehouse_issues.create", description: "Report a warehouse pick issue" },
  { key: "warehouse_issues.resolve", description: "Resolve or cancel a warehouse pick issue" },
  {
    key: "warehouse_notes.create",
    description: "Add an internal note to a warehouse pick job",
  },
  // Milestone 14 — exception cases (returns, warranty claims, production
  // defects). Refunds/credits are record-only (no Shopify money movement);
  // return labels are a manual/external fact — see ADR-0010.
  { key: "exception_cases.view", description: "View exception cases for an order" },
  {
    key: "exception_cases.create",
    description: "Report a new exception case (return, warranty claim, or production defect)",
  },
  {
    key: "exception_cases.update",
    description:
      "Edit an exception case's details, transition its investigation status, and record a return label",
  },
  { key: "exception_cases.assign", description: "Assign an exception case to staff" },
  {
    key: "exception_cases.resolve",
    description:
      "Record a resolution for an exception case (reprint, credit, refund, exchange, or denied) and mark a resolution completed",
  },
  { key: "exception_cases.cancel", description: "Cancel an exception case" },
  {
    key: "exception_notes.create",
    description: "Add an internal note to an exception case",
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
    "proof_requests.create",
    "proof_requests.view",
    "proof_requests.resend",
    "proof_requests.revoke",
    "proof_responses.view",
    "proof_responses.override",
    "proof_reminders.manage",
    "freight_shipments.view",
    "freight_shipments.create",
    "freight_shipments.download",
    "freight_shipments.cancel",
    "warehouse_picks.view",
    "warehouse_picks.assign",
    "warehouse_picks.record_quantity",
    "warehouse_picks.mark_short",
    "warehouse_picks.handover",
    "warehouse_issues.create",
    "warehouse_issues.resolve",
    "warehouse_notes.create",
    "exception_cases.view",
    "exception_cases.create",
    "exception_cases.update",
    "exception_cases.assign",
    "exception_cases.resolve",
    "exception_cases.cancel",
    "exception_notes.create",
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
    "proof_requests.create",
    "proof_requests.view",
    "proof_requests.resend",
    "proof_requests.revoke",
    "proof_responses.view",
    "proof_responses.override",
    "proof_reminders.manage",
    // Milestone 14 — any staff member can report a problem and add notes;
    // only management updates/assigns/resolves/cancels a case.
    "exception_cases.view",
    "exception_cases.create",
    "exception_notes.create",
    "notes.internal.view",
    "notes.internal.create",
    "overrides.create",
  ],
  // Originally the floor-work role (screen print/DTF/embroidery/press) for
  // the now-removed in-Hub Production Job queue — kept as a role with
  // read-only visibility into proofs/orders rather than deleted, since real
  // print work still happens (just tracked via Dropbox + the Kanban board
  // outside the Hub).
  PRINT_STAFF: [
    "board.view",
    "orders.view",
    "proof_groups.view",
    "proof_versions.view",
    "proof_requests.view",
    "proof_responses.view",
    "exception_cases.view",
    "exception_cases.create",
    "exception_notes.create",
  ],
  PACKING_STAFF: [
    "board.view",
    // Milestone 12 — this role's first real capability: view/download only
    // for now (matching the milestone's own suggested access) — shipment
    // creation and cancellation stay Manager-only until real usage patterns
    // justify widening it.
    "freight_shipments.view",
    "freight_shipments.download",
    // Milestone 13 — this role's first real job-execution capability set:
    // everything needed to run the pick queue day to day, but issue
    // resolution stays Manager-only.
    "warehouse_picks.view",
    "warehouse_picks.assign",
    "warehouse_picks.record_quantity",
    "warehouse_picks.mark_short",
    "warehouse_picks.handover",
    "warehouse_issues.create",
    "warehouse_notes.create",
    "exception_cases.view",
    "exception_cases.create",
    "exception_notes.create",
  ],
};

// The three Admin API scopes actually read from (read_orders, read_products,
// read_customers) plus write_fulfillments, the one write scope in use since
// Milestone 12's fulfillmentCreate tracking sync — kept as one source of
// truth here rather than letting docs/development.md's scope list and this
// value silently drift apart the way they previously had.
const SHOPIFY_SCOPES = "read_orders,read_products,read_customers,write_fulfillments";

async function main() {
  // Sourced from env, not hardcoded — env.server.ts already requires both of
  // these to be set for the app to boot at all, so re-running the seed is
  // the supported way to point this app at a real store (or back at a local
  // placeholder) without hand-editing the database. This is a single-shop
  // app in practice (no multi-tenant onboarding flow exists), so there is
  // always exactly one Shop row: update it in place if one already exists,
  // rather than upserting by domain, which would otherwise create a second
  // orphaned row the moment SHOPIFY_SHOP_DOMAIN changes between seed runs.
  const shopifyDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const adminApiToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (!shopifyDomain || !adminApiToken) {
    throw new Error(
      "SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_API_TOKEN must both be set in .env before seeding.",
    );
  }

  const existingShop = await db.shop.findFirst();
  const shop = existingShop
    ? await db.shop.update({
        where: { id: existingShop.id },
        data: { shopifyDomain, adminApiToken, scopes: SHOPIFY_SCOPES },
      })
    : await db.shop.create({
        data: {
          shopifyDomain,
          shopifyShopGid: "gid://shopify/Shop/0000000000",
          adminApiToken,
          scopes: SHOPIFY_SCOPES,
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
