import type { ReactNode } from "react";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";

export interface PermissionGateProps {
  staffUser: StaffUserWithPermissions;
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}

// Client-side gating for presentation only — the underlying route/action
// must always do its own server-side requireStaffUser + hasPermission check.
// This just centralises the "check then render" pattern in JSX so it isn't
// hand-rolled at every call site.
export function PermissionGate({
  staffUser,
  permission,
  children,
  fallback = null,
}: PermissionGateProps) {
  return hasPermission(staffUser, permission) ? <>{children}</> : <>{fallback}</>;
}
