import { Outlet } from "react-router";
import type { Route } from "./+types/app";
import { requireStaffUser } from "~/auth/staff-session.server";
import { countUnresolvedIntegrationFailures } from "~/domain/integrations/count-unresolved.server";
import {
  countUnreadNotifications,
  loadRecentNotifications,
} from "~/domain/notifications/notification-query.server";
import { AppShell } from "~/components/shell/AppShell";

// Pathless layout route — every authenticated page nests under this so the
// shell (header/sidebar/nav) and the single requireStaffUser call for the
// page shell live in exactly one place. Nested routes still do their own
// requireStaffUser + permission checks, since a route must never rely on an
// ancestor for its own authorization.
export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  const [integrationIssueCount, notifications, unreadNotificationCount] = await Promise.all([
    countUnresolvedIntegrationFailures(staffUser.shopId),
    loadRecentNotifications(staffUser.id),
    countUnreadNotifications(staffUser.id),
  ]);
  return { staffUser, integrationIssueCount, notifications, unreadNotificationCount };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { staffUser, integrationIssueCount, notifications, unreadNotificationCount } = loaderData;

  return (
    <AppShell
      staffUser={staffUser}
      integrationIssueCount={integrationIssueCount}
      notifications={notifications}
      unreadNotificationCount={unreadNotificationCount}
    >
      <Outlet />
    </AppShell>
  );
}
