import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import type { Notification } from "@prisma/client";
import { NotificationMenu } from "~/components/shell/NotificationMenu";

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif_1",
    staffUserId: "staff_1",
    type: "exception_case_assigned",
    title: "Assigned to you: case JS-1",
    body: null,
    relatedEntityType: "ExceptionCase",
    relatedEntityId: "case_1",
    readAt: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

function renderMenu(notifications: Notification[], unreadCount: number) {
  const Stub = createRoutesStub([
    {
      path: "/dashboard",
      Component: () => <NotificationMenu notifications={notifications} unreadCount={unreadCount} />,
    },
    { path: "/notifications/actions", action: () => null },
    { path: "/exceptions/:caseId", Component: () => <p>Exception case page</p> },
  ]);
  return render(<Stub initialEntries={["/dashboard"]} />);
}

// Radix's DropdownMenu.Content only opens on real pointer events, which
// jsdom doesn't fully emulate — the established convention in this codebase
// (see UserMenu.test.tsx) is to verify the accessible trigger renders
// correctly rather than fireEvent-clicking the content open. Manual/browser
// verification covers the actual dropdown contents.
describe("NotificationMenu", () => {
  it("exposes an accessible trigger with no unread count when there's nothing unread", () => {
    renderMenu([], 0);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("labels the trigger with a real unread count, singular", () => {
    renderMenu([notification()], 1);
    expect(screen.getByRole("button", { name: "1 unread notification" })).toBeInTheDocument();
  });

  it("labels the trigger with a real unread count, plural", () => {
    renderMenu([notification(), notification({ id: "notif_2" })], 2);
    expect(screen.getByRole("button", { name: "2 unread notifications" })).toBeInTheDocument();
  });
});
