import type { Route } from "./+types/integrations";
import { db } from "~/lib/db.server";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { OPEN_STATUSES } from "~/domain/integrations/record-failure.server";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";
import { Badge, type BadgeTone } from "~/components/shared/Badge";

// Read-only for now — retry/resolve/assign actions belong to the dedicated
// integration-issues milestone (SRS Section 19). This just makes existing
// unresolved failures visible.
const LIST_CAP = 100;

const SEVERITY_TONE: Record<string, BadgeTone> = {
  LOW: "neutral",
  MEDIUM: "warning",
  HIGH: "warning",
  CRITICAL: "error",
};

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Integration Issues — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "integrations.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const failures = await db.integrationFailure.findMany({
    where: { shopId: staffUser.shopId, status: { in: OPEN_STATUSES } },
    orderBy: { latestFailureAt: "desc" },
    take: LIST_CAP,
  });

  return { failures };
}

export default function Integrations({ loaderData }: Route.ComponentProps) {
  const { failures } = loaderData;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integration Issues"
        description="Unresolved failures from Shopify and other integrations, most recent first."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Integration Issues" }]}
      />

      {failures.length === 0 ? (
        <EmptyState
          title="No unresolved integration issues"
          description="Everything is in sync — new failures will appear here as they occur."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="px-4 py-2 font-medium">Summary</th>
                <th className="px-4 py-2 font-medium">Integration</th>
                <th className="px-4 py-2 font-medium">Severity</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Attempts</th>
                <th className="px-4 py-2 font-medium">Latest failure</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((failure) => (
                <tr key={failure.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-2 text-ink">{failure.summary}</td>
                  <td className="px-4 py-2 text-muted">{failure.integration}</td>
                  <td className="px-4 py-2">
                    <Badge tone={SEVERITY_TONE[failure.severity] ?? "neutral"}>
                      {failure.severity}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-muted">{failure.status}</td>
                  <td className="px-4 py-2 text-muted">{failure.attemptCount}</td>
                  <td className="px-4 py-2 text-muted">
                    {new Date(failure.latestFailureAt).toLocaleString("en-AU")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
