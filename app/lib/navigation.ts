import {
  Brush,
  ClipboardList,
  Factory,
  FileSearch,
  LayoutDashboard,
  PackageCheck,
  RotateCcw,
  Settings,
  ShieldAlert,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { StaffUserWithPermissions } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Undefined means visible to any signed-in staff member. */
  permission?: string;
  /**
   * False means no route exists yet for this item — it is filtered out of
   * every rendered nav entirely rather than linking to a page that doesn't
   * exist. This lets the full intended structure (SRS Section 9's module
   * list) live in one place now, with later milestones flipping items to
   * true as their routes land, instead of restructuring this file per
   * milestone.
   */
  implemented: boolean;
  /** Data source for a badge on this item, e.g. an unresolved-issue count. */
  badge?: "integrationIssues";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: "Work",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, implemented: true },
      {
        label: "Orders",
        href: "/orders",
        icon: ClipboardList,
        permission: "board.view",
        implemented: true,
      },
      { label: "Proofing", href: "/proofing", icon: Brush, implemented: false },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Production", href: "/production", icon: Factory, implemented: false },
      { label: "Warehouse", href: "/warehouse", icon: Warehouse, implemented: false },
      { label: "Packing", href: "/packing", icon: PackageCheck, implemented: false },
      { label: "Returns", href: "/returns", icon: RotateCcw, implemented: false },
    ],
  },
  {
    label: "Tools",
    items: [
      {
        label: "Raw Data Inspector",
        href: "/dev/orders",
        icon: FileSearch,
        permission: "raw_data.view",
        implemented: true,
      },
      {
        label: "Integration Issues",
        href: "/integrations",
        icon: ShieldAlert,
        permission: "integrations.view",
        implemented: true,
        badge: "integrationIssues",
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        permission: "settings.manage",
        implemented: false,
      },
      {
        label: "Staff and Permissions",
        href: "/staff",
        icon: Users,
        permission: "staff.manage",
        implemented: false,
      },
    ],
  },
];

// The only place implemented/permission filtering happens — AppSidebar and
// MobileNavigation both call this instead of each re-deriving visibility.
export function getVisibleNavigation(staffUser: StaffUserWithPermissions): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.implemented && (!item.permission || hasPermission(staffUser, item.permission)),
    ),
  })).filter((group) => group.items.length > 0);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
