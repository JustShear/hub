import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { updateStaffThemePreference } from "~/domain/staff/update-theme-preference.server";

describe("updateStaffThemePreference (integration)", () => {
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdStaffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  async function createStaffUser() {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Staff",
        passwordHash: "irrelevant",
      },
    });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  it("defaults a new staff user to CLASSIC", async () => {
    const staffUser = await createStaffUser();
    expect(staffUser.theme).toBe("CLASSIC");
  });

  it("updates the staff user's theme preference", async () => {
    const staffUser = await createStaffUser();

    await updateStaffThemePreference(staffUser.id, "DARK");

    const updated = await db.staffUser.findUniqueOrThrow({ where: { id: staffUser.id } });
    expect(updated.theme).toBe("DARK");
  });

  it("can switch back to a different theme", async () => {
    const staffUser = await createStaffUser();

    await updateStaffThemePreference(staffUser.id, "COLOURED_MODERN");
    await updateStaffThemePreference(staffUser.id, "CLASSIC");

    const updated = await db.staffUser.findUniqueOrThrow({ where: { id: staffUser.id } });
    expect(updated.theme).toBe("CLASSIC");
  });
});
