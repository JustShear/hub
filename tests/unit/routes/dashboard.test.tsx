import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import Dashboard from "~/routes/dashboard";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";

function staffUserWith(permissionKeys: string[]): StaffUserWithPermissions {
  return {
    id: "staff_1",
    shopId: "shop_1",
    email: "admin@example.com",
    name: "Administrator",
    roleNames: ["ADMINISTRATOR"],
    permissionKeys: new Set(permissionKeys),
    theme: "CLASSIC",
  };
}

function renderDashboard(staffUser: StaffUserWithPermissions, integrationIssueCount: number) {
  const Stub = createRoutesStub([
    {
      path: "/dashboard",
      Component: Dashboard,
      loader() {
        return { staffUser, integrationIssueCount };
      },
    },
  ]);

  return render(<Stub initialEntries={["/dashboard"]} />);
}

describe("Dashboard route", () => {
  it("greets the signed-in staff member by name", async () => {
    renderDashboard(staffUserWith(["raw_data.view", "integrations.view"]), 0);
    expect(
      await screen.findByRole("heading", { name: "Welcome, Administrator" }),
    ).toBeInTheDocument();
  });

  it("shows only shortcuts the staff member has permission for", async () => {
    renderDashboard(staffUserWith(["raw_data.view"]), 0);
    expect(await screen.findByText("Raw Data Inspector")).toBeInTheDocument();
    expect(screen.queryByText("Integration Issues")).not.toBeInTheDocument();
  });

  it("shows an honest empty state instead of fabricated shortcuts for a staff member with no permissions", async () => {
    renderDashboard(staffUserWith([]), 0);
    expect(await screen.findByText("No modules available yet")).toBeInTheDocument();
    expect(screen.queryByText("Raw Data Inspector")).not.toBeInTheDocument();
    expect(screen.queryByText("Integration Issues")).not.toBeInTheDocument();
  });

  it("reports zero unresolved issues honestly rather than omitting the figure", async () => {
    renderDashboard(staffUserWith(["integrations.view"]), 0);
    expect(await screen.findByText("No unresolved issues.")).toBeInTheDocument();
  });

  it("shows the real unresolved-issue count when there are open issues", async () => {
    renderDashboard(staffUserWith(["integrations.view"]), 3);
    expect(await screen.findByText("3 unresolved issues.")).toBeInTheDocument();
  });

  it("names Kanban/production modules as a future milestone rather than faking them", async () => {
    renderDashboard(staffUserWith([]), 0);
    expect(await screen.findByText(/coming in a future milestone/i)).toBeInTheDocument();
  });
});
