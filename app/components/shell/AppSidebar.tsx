import type { NavGroup } from "~/lib/navigation";
import { NavLinks } from "~/components/shell/NavLinks";

export interface AppSidebarProps {
  groups: NavGroup[];
  integrationIssueCount: number;
}

// Fixed left column, desktop only — below the lg breakpoint navigation
// moves into MobileNavigation's drawer instead.
export function AppSidebar({ groups, integrationIssueCount }: AppSidebarProps) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-surface p-4 lg:block">
      <NavLinks groups={groups} integrationIssueCount={integrationIssueCount} />
    </aside>
  );
}
