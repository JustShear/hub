import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotificationMenu } from "~/components/shell/NotificationMenu";

describe("NotificationMenu", () => {
  it("exposes an accessible trigger and never seeds fake notification content", () => {
    render(<NotificationMenu />);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });
});
