import { describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { authenticateStaffUser } from "~/auth/authenticate.server";

// Runs against the real local Postgres (docker-compose), using the admin
// user created by `npm run db:seed`. Requires the database to be up and
// seeded — same requirement as `npm run dev`.
describe("authenticateStaffUser (integration)", () => {
  it("succeeds with the seeded admin's correct credentials", async () => {
    const shop = await db.shop.findFirstOrThrow();

    const result = await authenticateStaffUser(
      shop.id,
      "admin@justshear.com",
      "change-me-on-first-login",
    );

    expect(result).not.toBeNull();
  });

  it("fails with the correct email but wrong password", async () => {
    const shop = await db.shop.findFirstOrThrow();

    const result = await authenticateStaffUser(shop.id, "admin@justshear.com", "wrong-password");

    expect(result).toBeNull();
  });

  it("fails for an email that doesn't exist", async () => {
    const shop = await db.shop.findFirstOrThrow();

    const result = await authenticateStaffUser(
      shop.id,
      "nobody@justshear.com",
      "change-me-on-first-login",
    );

    expect(result).toBeNull();
  });
});
