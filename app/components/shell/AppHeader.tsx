import { Link } from "react-router";
import type { Notification } from "@prisma/client";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import type { NavGroup } from "~/lib/navigation";
import { MobileNavigation } from "~/components/shell/MobileNavigation";
import { GlobalSearch } from "~/components/shell/GlobalSearch";
import { IntegrationIssueIndicator } from "~/components/shell/IntegrationIssueIndicator";
import { NotificationMenu } from "~/components/shell/NotificationMenu";
import { UserMenu } from "~/components/shell/UserMenu";

export interface AppHeaderProps {
  staffUser: StaffUserWithPermissions;
  groups: NavGroup[];
  integrationIssueCount: number;
  notifications: Notification[];
  unreadNotificationCount: number;
}

export function AppHeader({
  staffUser,
  groups,
  integrationIssueCount,
  notifications,
  unreadNotificationCount,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4">
      <div className="flex items-center gap-2">
        <MobileNavigation groups={groups} integrationIssueCount={integrationIssueCount} />
        <Link
          to="/dashboard"
          className="rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        >
          <img src="/logo.png" alt="Just Shear" className="h-7 w-auto" />
        </Link>
      </div>
      <div className="flex items-center gap-1.5">
        <GlobalSearch />
        {hasPermission(staffUser, "integrations.view") ? (
          <IntegrationIssueIndicator count={integrationIssueCount} />
        ) : null}
        <NotificationMenu notifications={notifications} unreadCount={unreadNotificationCount} />
        <UserMenu staffUser={staffUser} />
      </div>
    </header>
  );
}
