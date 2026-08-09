import { Link } from "react-router";
import { AlertOctagon, FileSearch, PackageSearch, ShieldAlert } from "lucide-react";
import type { Route } from "./+types/dashboard";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { countUnresolvedIntegrationFailures } from "~/domain/integrations/count-unresolved.server";
import { getWarehouseDashboardMetrics } from "~/domain/warehouse/dashboard-metrics.server";
import { getExceptionsDashboardMetrics } from "~/domain/exceptions/exceptions-dashboard-metrics.server";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Dashboard — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  const canViewWarehouseQueue = hasPermission(staffUser, "warehouse_picks.view");
  const canViewExceptionCases = hasPermission(staffUser, "exception_cases.view");
  const [integrationIssueCount, warehouseMetrics, exceptionsMetrics] = await Promise.all([
    countUnresolvedIntegrationFailures(staffUser.shopId),
    canViewWarehouseQueue ? getWarehouseDashboardMetrics(staffUser.shopId) : Promise.resolve(null),
    canViewExceptionCases
      ? getExceptionsDashboardMetrics(staffUser.shopId)
      : Promise.resolve(null),
  ]);
  return {
    staffUser,
    integrationIssueCount,
    warehouseMetrics,
    exceptionsMetrics,
  };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { staffUser, integrationIssueCount, warehouseMetrics, exceptionsMetrics } = loaderData;

  const shortcuts = [
    warehouseMetrics
      ? {
          href: "/warehouse",
          icon: PackageSearch,
          label: "Warehouse Picking",
          description: `${warehouseMetrics.inProgressCount} in progress · ${warehouseMetrics.queuedCount} queued.`,
        }
      : null,
    exceptionsMetrics
      ? {
          href: "/exceptions",
          icon: AlertOctagon,
          label: "Exceptions",
          description: `${exceptionsMetrics.openCount} open · ${exceptionsMetrics.investigatingCount} investigating.`,
        }
      : null,
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

      {warehouseMetrics ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">Warehouse picking at a glance</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Queued", value: warehouseMetrics.queuedCount },
              { label: "In progress", value: warehouseMetrics.inProgressCount },
              { label: "Handed over today", value: warehouseMetrics.handedOverTodayCount },
              { label: "With a shortage", value: warehouseMetrics.withShortageCount },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xl font-semibold text-ink">{stat.value}</p>
                <p className="text-xs text-muted">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {exceptionsMetrics ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">Exceptions at a glance</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Open", value: exceptionsMetrics.openCount },
              { label: "Investigating", value: exceptionsMetrics.investigatingCount },
              { label: "Awaiting customer", value: exceptionsMetrics.awaitingCustomerCount },
              { label: "Resolved today", value: exceptionsMetrics.resolvedTodayCount },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xl font-semibold text-ink">{stat.value}</p>
                <p className="text-xs text-muted">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <p className="text-sm text-muted">
        Packing and full inventory tracking are coming in a future milestone — this dashboard will
        grow shortcuts and summaries as those modules ship.
      </p>
    </div>
  );
}
