import type { Route } from "./+types/production.$jobId";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { loadProductionJobDetail } from "~/domain/production/job-detail-query.server";
import { getAssignableStaff } from "~/domain/orders/order-detail-query.server";
import { ProductionJobDrawer } from "~/components/production/ProductionJobDrawer";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `Job ${loaderData.job.jobNumber} — Just Shear Production Hub` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "production_jobs.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const detail = await loadProductionJobDetail({ shopId: staffUser.shopId, jobId: params.jobId });
  if (!detail) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Production job not found", { status: 404 });
  }

  const assignableStaff = await getAssignableStaff(staffUser.shopId);

  return {
    ...detail,
    assignableStaff,
    canAssign: hasPermission(staffUser, "production_jobs.assign"),
    canUpdate: hasPermission(staffUser, "production_jobs.update"),
    canStart: hasPermission(staffUser, "production_jobs.start"),
    canPause: hasPermission(staffUser, "production_jobs.pause"),
    canComplete: hasPermission(staffUser, "production_jobs.complete"),
    canReopen:
      hasPermission(staffUser, "production_jobs.reopen") &&
      hasPermission(staffUser, "production_overrides.create"),
    canUpdateQuantities: hasPermission(staffUser, "production_quantities.update"),
    canOverrideQuantities: hasPermission(staffUser, "production_overrides.create"),
    canPerformQualityCheck: hasPermission(staffUser, "production_quality_check.perform"),
    canCreateIssues: hasPermission(staffUser, "production_issues.create"),
    canResolveIssues: hasPermission(staffUser, "production_issues.resolve"),
    canCreateNotes: hasPermission(staffUser, "production_notes.create"),
    canDownloadArtwork: hasPermission(staffUser, "production_artwork.view"),
  };
}

export default function ProductionJobRoute({ loaderData }: Route.ComponentProps) {
  return <ProductionJobDrawer {...loaderData} />;
}
