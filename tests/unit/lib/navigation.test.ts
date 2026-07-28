import { describe, expect, it } from "vitest";
import { LayoutDashboard } from "lucide-react";
import { getVisibleNavigation, isNavItemActive, NAVIGATION } from "~/lib/navigation";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";

function staffUserWith(permissionKeys: string[]): StaffUserWithPermissions {
  return {
    id: "staff_1",
    shopId: "shop_1",
    email: "test@example.com",
    name: "Test Staff",
    roleNames: ["TEST"],
    permissionKeys: new Set(permissionKeys),
  };
}

describe("getVisibleNavigation", () => {
  it("hides items marked implemented: false regardless of permission", () => {
    const admin = staffUserWith(NAVIGATION.flatMap((g) => g.items.map((i) => i.permission ?? "")));
    const groups = getVisibleNavigation(admin);
    const allLabels = groups.flatMap((g) => g.items.map((i) => i.label));

    expect(allLabels).not.toContain("Proofing");
    expect(allLabels).not.toContain("Settings");
  });

  it("only shows Orders to staff with board.view", () => {
    const groups = getVisibleNavigation(staffUserWith(["board.view"]));
    const allLabels = groups.flatMap((g) => g.items.map((i) => i.label));

    expect(allLabels).toContain("Orders");
  });

  it("shows Dashboard to any signed-in staff member with no permissions", () => {
    const groups = getVisibleNavigation(staffUserWith([]));
    const allLabels = groups.flatMap((g) => g.items.map((i) => i.label));

    expect(allLabels).toEqual(["Dashboard"]);
  });

  it("only shows Raw Data Inspector to staff with raw_data.view", () => {
    const groups = getVisibleNavigation(staffUserWith(["raw_data.view"]));
    const allLabels = groups.flatMap((g) => g.items.map((i) => i.label));

    expect(allLabels).toContain("Raw Data Inspector");
    expect(allLabels).not.toContain("Integration Issues");
  });

  it("only shows Integration Issues to staff with integrations.view", () => {
    const groups = getVisibleNavigation(staffUserWith(["integrations.view"]));
    const allLabels = groups.flatMap((g) => g.items.map((i) => i.label));

    expect(allLabels).toContain("Integration Issues");
    expect(allLabels).not.toContain("Raw Data Inspector");
  });

  it("omits a group entirely once none of its items are visible", () => {
    const groups = getVisibleNavigation(staffUserWith([]));
    expect(groups.map((g) => g.label)).toEqual(["Work"]);
  });
});

describe("isNavItemActive", () => {
  const item = {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    implemented: true,
  };

  it("matches an exact path", () => {
    expect(isNavItemActive(item, "/dashboard")).toBe(true);
  });

  it("matches a nested path", () => {
    expect(isNavItemActive(item, "/dashboard/anything")).toBe(true);
  });

  it("does not match an unrelated path", () => {
    expect(isNavItemActive(item, "/dev/orders")).toBe(false);
  });

  it("does not match a different path that merely shares a prefix", () => {
    expect(isNavItemActive(item, "/dashboardish")).toBe(false);
  });
});
