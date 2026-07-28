import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { Breadcrumbs } from "~/components/shared/Breadcrumbs";

describe("Breadcrumbs", () => {
  it("renders each crumb, links every crumb but the last, and marks the last as the current page", async () => {
    const Stub = createRoutesStub([
      {
        path: "/dev/orders/123",
        Component: () => (
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Raw Data Inspector", href: "/dev/orders" },
              { label: "#1001" },
            ]}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/dev/orders/123"]} />);

    expect(await screen.findByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: "Raw Data Inspector" })).toHaveAttribute(
      "href",
      "/dev/orders",
    );

    const current = screen.getByText("#1001");
    expect(current.tagName).toBe("SPAN");
    expect(current).toHaveAttribute("aria-current", "page");
  });
});
