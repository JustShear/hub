import type { ReactNode } from "react";
import type { Notification } from "@prisma/client";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";
import { getVisibleNavigation } from "~/lib/navigation";
import { AppHeader } from "~/components/shell/AppHeader";
import { AppSidebar } from "~/components/shell/AppSidebar";

export interface AppShellProps {
  staffUser: StaffUserWithPermissions;
  integrationIssueCount: number;
  notifications: Notification[];
  unreadNotificationCount: number;
  children: ReactNode;
}

// The one place navigation visibility is computed for a page render — both
// the header (mobile drawer) and the desktop sidebar are handed the same
// already-filtered groups so they can never disagree.
export function AppShell({
  staffUser,
  integrationIssueCount,
  notifications,
  unreadNotificationCount,
  children,
}: AppShellProps) {
  const groups = getVisibleNavigation(staffUser);

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <AppHeader
        staffUser={staffUser}
        groups={groups}
        integrationIssueCount={integrationIssueCount}
        notifications={notifications}
        unreadNotificationCount={unreadNotificationCount}
      />
      <div className="flex flex-1">
        <AppSidebar groups={groups} integrationIssueCount={integrationIssueCount} />
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
