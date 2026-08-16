import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { UserMenu } from "~/components/shell/UserMenu";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";

function staffUserWith(theme: StaffUserWithPermissions["theme"]): StaffUserWithPermissions {
  return {
    id: "staff_1",
    shopId: "shop_1",
    email: "admin@justshear.com",
    name: "Administrator",
    roleNames: ["ADMINISTRATOR"],
    permissionKeys: new Set(),
    theme,
  };
}

function renderMenu(staffUser: StaffUserWithPermissions) {
  const Stub = createRoutesStub([
    { path: "/dashboard", Component: () => <UserMenu staffUser={staffUser} /> },
    { path: "/logout", action: () => null },
    { path: "/profile/actions", action: () => ({ intent: "setTheme", ok: true }) },
  ]);
  return render(<Stub initialEntries={["/dashboard"]} />);
}

describe("UserMenu", () => {
  it("exposes an accessible trigger naming the signed-in staff member", () => {
    renderMenu(staffUserWith("CLASSIC"));

    expect(
      screen.getByRole("button", { name: "Account menu for Administrator" }),
    ).toBeInTheDocument();
  });

  it("shows all four theme options with the staff member's current choice checked", async () => {
    renderMenu(staffUserWith("DARK"));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Account menu for Administrator" }));

    await screen.findByRole("menuitemradio", { name: "Dark" });
    expect(screen.getByRole("menuitemradio", { name: "Classic" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Coloured modern" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("menuitemradio", { name: "Cats" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("submits a setTheme intent with the chosen theme to /profile/actions", async () => {
    // Radix's RadioItem closes the dropdown on select, unmounting its own
    // content — so this asserts the actual POST payload the fetcher sent
    // rather than re-querying the (now-closed) menu for a checked state.
    let submittedTheme: string | null = null;
    const Stub = createRoutesStub([
      { path: "/dashboard", Component: () => <UserMenu staffUser={staffUserWith("CLASSIC")} /> },
      { path: "/logout", action: () => null },
      {
        path: "/profile/actions",
        action: async ({ request }) => {
          const formData = await request.formData();
          submittedTheme = formData.get("theme") as string | null;
          return { intent: "setTheme", ok: true };
        },
      },
    ]);
    render(<Stub initialEntries={["/dashboard"]} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Account menu for Administrator" }));

    const option = await screen.findByRole("menuitemradio", { name: "Coloured modern" });
    fireEvent.click(option);

    await waitFor(() => {
      expect(submittedTheme).toBe("COLOURED_MODERN");
    });
  });

  it("submits CATS when the Cats theme is chosen", async () => {
    let submittedTheme: string | null = null;
    const Stub = createRoutesStub([
      { path: "/dashboard", Component: () => <UserMenu staffUser={staffUserWith("CLASSIC")} /> },
      { path: "/logout", action: () => null },
      {
        path: "/profile/actions",
        action: async ({ request }) => {
          const formData = await request.formData();
          submittedTheme = formData.get("theme") as string | null;
          return { intent: "setTheme", ok: true };
        },
      },
    ]);
    render(<Stub initialEntries={["/dashboard"]} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Account menu for Administrator" }));

    const option = await screen.findByRole("menuitemradio", { name: "Cats" });
    fireEvent.click(option);

    await waitFor(() => {
      expect(submittedTheme).toBe("CATS");
    });
  });
});
