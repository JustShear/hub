import type { StaffUserWithPermissions } from "~/auth/staff-session.server";

// No ".server" suffix, deliberately — this is a pure function with no DB
// access and no secrets, so it's safe to run in the browser too. Components
// (PermissionGate, nav visibility, dashboard shortcuts) call it directly to
// decide what to render; it must stay import-safe for the client bundle.
export function hasPermission(staffUser: StaffUserWithPermissions, permissionKey: string): boolean {
  return staffUser.permissionKeys.has(permissionKey);
}
