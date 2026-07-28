import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { LayoutDashboard } from "lucide-react";
import { MobileNavigation } from "~/components/shell/MobileNavigation";
import type { NavGroup } from "~/lib/navigation";

const groups: NavGroup[] = [
  {
    label: "Work",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, implemented: true }],
  },
];

function renderDrawer() {
  const Stub = createRoutesStub([
    {
      path: "/dashboard",
      Component: () => <MobileNavigation groups={groups} integrationIssueCount={0} />,
    },
  ]);
  return render(<Stub initialEntries={["/dashboard"]} />);
}

describe("MobileNavigation", () => {
  it("opens the drawer and shows the nav tree when the menu button is clicked", async () => {
    renderDrawer();

    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));

    expect(await screen.findByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("closes the drawer when Escape is pressed", async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await screen.findByRole("link", { name: "Dashboard" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    });
  });

  it("closes the drawer after a nav link is clicked", async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const link = await screen.findByRole("link", { name: "Dashboard" });

    fireEvent.click(link);

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    });
  });
});
