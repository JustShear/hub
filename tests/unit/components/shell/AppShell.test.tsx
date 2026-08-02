import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { AppShell } from "~/components/shell/AppShell";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";

function staffUserWith(permissionKeys: string[]): StaffUserWithPermissions {
  return {
    id: "staff_1",
    shopId: "shop_1",
    email: "admin@justshear.com",
    name: "Administrator",
    roleNames: ["ADMINISTRATOR"],
    permissionKeys: new Set(permissionKeys),
  };
}

function renderShell(staffUser: StaffUserWithPermissions, integrationIssueCount = 0) {
  const Stub = createRoutesStub([
    {
      path: "/dashboard",
      Component: () => (
        <AppShell
          staffUser={staffUser}
          integrationIssueCount={integrationIssueCount}
          notifications={[]}
          unreadNotificationCount={0}
        >
          <p>Page content</p>
        </AppShell>
      ),
    },
    { path: "/logout", action: () => null },
    { path: "/notifications/actions", action: () => null },
  ]);
  return render(<Stub initialEntries={["/dashboard"]} />);
}

describe("AppShell", () => {
  it("renders the header, sidebar navigation, and page content for an authenticated staff member", () => {
    renderShell(staffUserWith(["raw_data.view"]));

    expect(screen.getByRole("link", { name: "Just Shear" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Dashboard/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Raw Data Inspector").length).toBeGreaterThan(0);
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Account menu for Administrator" }),
    ).toBeInTheDocument();
  });

  it("only shows the integration-issue indicator to staff with integrations.view", () => {
    renderShell(staffUserWith([]));
    expect(screen.queryByLabelText(/integration issue/i)).not.toBeInTheDocument();
  });

  it("shows the integration-issue indicator with a real count for staff with integrations.view", () => {
    renderShell(staffUserWith(["integrations.view"]), 2);
    expect(screen.getByLabelText("2 unresolved integration issues")).toBeInTheDocument();
  });
});
