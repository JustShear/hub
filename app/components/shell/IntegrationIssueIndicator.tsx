import { ShieldAlert } from "lucide-react";
import { Link } from "react-router";

export interface IntegrationIssueIndicatorProps {
  count: number;
}

// A real count, sourced from countUnresolvedIntegrationFailures — never
// shows a badge for issues that don't exist, and shows no badge (not a
// fake "0") when the count is zero.
export function IntegrationIssueIndicator({ count }: IntegrationIssueIndicatorProps) {
  return (
    <Link
      to="/integrations"
      aria-label={
        count > 0
          ? `${count} unresolved integration issue${count === 1 ? "" : "s"}`
          : "Integration issues"
      }
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
    >
      <ShieldAlert aria-hidden="true" className="h-5 w-5" />
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-semibold text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
