import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { LayoutDashboard, ShieldAlert } from "lucide-react";
import { NavLinks } from "~/components/shell/NavLinks";
import type { NavGroup } from "~/lib/navigation";

const groups: NavGroup[] = [
  {
    label: "Work",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, implemented: true }],
  },
  {
    label: "Tools",
    items: [
      {
        label: "Integration Issues",
        href: "/integrations",
        icon: ShieldAlert,
        implemented: true,
        badge: "integrationIssues",
      },
    ],
  },
];

function renderAt(path: string, integrationIssueCount = 0) {
  const Stub = createRoutesStub([
    {
      path,
      Component: () => <NavLinks groups={groups} integrationIssueCount={integrationIssueCount} />,
    },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

describe("NavLinks", () => {
  it("renders every group and item label", () => {
    renderAt("/dashboard");
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Integration Issues")).toBeInTheDocument();
  });

  it("marks the link matching the current path as the active page", () => {
    renderAt("/dashboard");
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Integration Issues/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("shows no badge when the unresolved-issue count is zero", () => {
    renderAt("/dashboard", 0);
    const link = screen.getByRole("link", { name: /Integration Issues/ });
    expect(link.textContent).toBe("Integration Issues");
  });

  it("shows a real badge count when there are unresolved issues", () => {
    renderAt("/dashboard", 5);
    const link = screen.getByRole("link", { name: /Integration Issues/ });
    expect(link.textContent).toContain("5");
  });
});
