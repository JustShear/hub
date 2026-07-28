import { describe, expect, it } from "vitest";
import { hasPermission } from "~/auth/rbac";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";

function staffUser(permissionKeys: string[]): StaffUserWithPermissions {
  return {
    id: "staff_1",
    shopId: "shop_1",
    email: "staff@justshear.com",
    name: "Test Staff",
    roleNames: ["PACKING_STAFF"],
    permissionKeys: new Set(permissionKeys),
  };
}

describe("hasPermission", () => {
  it("returns true when the staff user's roles grant the permission", () => {
    expect(hasPermission(staffUser(["board.view"]), "board.view")).toBe(true);
  });

  it("returns false when the permission isn't granted", () => {
    expect(hasPermission(staffUser(["board.view"]), "settings.manage")).toBe(false);
  });

  it("returns false for a staff user with no permissions at all", () => {
    expect(hasPermission(staffUser([]), "board.view")).toBe(false);
  });
});
