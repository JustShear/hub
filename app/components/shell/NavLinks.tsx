import { Link, useLocation } from "react-router";
import type { NavGroup } from "~/lib/navigation";
import { isNavItemActive } from "~/lib/navigation";

export interface NavLinksProps {
  groups: NavGroup[];
  integrationIssueCount: number;
  /** Called after a link is clicked — used to close the mobile drawer. */
  onNavigate?: () => void;
}

// Shared between AppSidebar (desktop) and MobileNavigation (drawer) so the
// nav tree, active-state logic, and badge rendering exist in exactly one
// place — only the surrounding chrome differs between the two callers.
export function NavLinks({ groups, integrationIssueCount, onNavigate }: NavLinksProps) {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-muted">
            {group.label}
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {group.items.map((item) => {
              const active = isNavItemActive(item, pathname);
              const Icon = item.icon;
              const badgeCount =
                item.badge === "integrationIssues" ? integrationIssueCount : undefined;

              return (
                <li key={item.href}>
                  <Link
                    to={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy ${
                      active
                        ? "bg-accent-blue/30 text-ink"
                        : "text-muted hover:bg-page hover:text-ink"
                    }`}
                  >
                    <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {badgeCount ? (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1.5 text-xs font-semibold text-white">
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
