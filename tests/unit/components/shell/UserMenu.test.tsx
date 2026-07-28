import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { UserMenu } from "~/components/shell/UserMenu";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";

const staffUser: StaffUserWithPermissions = {
  id: "staff_1",
  shopId: "shop_1",
  email: "admin@justshear.com",
  name: "Administrator",
  roleNames: ["ADMINISTRATOR"],
  permissionKeys: new Set(),
};

describe("UserMenu", () => {
  it("exposes an accessible trigger naming the signed-in staff member", () => {
    const Stub = createRoutesStub([
      { path: "/dashboard", Component: () => <UserMenu staffUser={staffUser} /> },
      { path: "/logout", action: () => null },
    ]);
    render(<Stub initialEntries={["/dashboard"]} />);

    expect(
      screen.getByRole("button", { name: "Account menu for Administrator" }),
    ).toBeInTheDocument();
  });
});
