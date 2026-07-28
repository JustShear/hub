import { Link } from "react-router";
import { FileSearch, ShieldAlert } from "lucide-react";
import type { Route } from "./+types/dashboard";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { countUnresolvedIntegrationFailures } from "~/domain/integrations/count-unresolved.server";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Dashboard — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  const integrationIssueCount = await countUnresolvedIntegrationFailures(staffUser.shopId);
  return { staffUser, integrationIssueCount };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { staffUser, integrationIssueCount } = loaderData;

  const shortcuts = [
    hasPermission(staffUser, "raw_data.view")
      ? {
          href: "/dev/orders",
          icon: FileSearch,
          label: "Raw Data Inspector",
          description: "Inspect imported Shopify orders and line properties.",
        }
      : null,
    hasPermission(staffUser, "integrations.view")
      ? {
          href: "/integrations",
          icon: ShieldAlert,
          label: "Integration Issues",
          description:
            integrationIssueCount > 0
              ? `${integrationIssueCount} unresolved issue${integrationIssueCount === 1 ? "" : "s"}.`
              : "No unresolved issues.",
        }
      : null,
  ].filter((shortcut) => shortcut !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome, ${staffUser.name}`}
        description={new Date().toLocaleDateString("en-AU", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      />

      {shortcuts.length === 0 ? (
        <EmptyState
          title="No modules available yet"
          description="Your account doesn't have access to any modules yet. Ask an administrator to grant a role."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((shortcut) => (
            <Link
              key={shortcut.href}
              to={shortcut.href}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 hover:border-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
            >
              <shortcut.icon aria-hidden="true" className="h-5 w-5 text-brand-navy" />
              <span className="font-medium text-ink">{shortcut.label}</span>
              <span className="text-sm text-muted">{shortcut.description}</span>
            </Link>
          ))}
        </div>
      )}

      <p className="text-sm text-muted">
        Order, proofing, production, warehouse, and packing workflows are coming in a future
        milestone — this dashboard will grow shortcuts and summaries as those modules ship.
      </p>
    </div>
  );
}
