import { Outlet } from "react-router";
import type { Route } from "./+types/production";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { parseProductionQueueSearchParams } from "~/domain/production/queue-filters";
import { loadProductionQueue } from "~/domain/production/queue-query.server";
import { getAssignableStaff } from "~/domain/orders/order-detail-query.server";
import { listGenericSavedViews } from "~/domain/saved-views/generic-saved-view.server";
import { PRODUCTION_SAVED_VIEW_SCOPE } from "~/domain/saved-views/scopes";
import { ProductionQueuePage } from "~/components/production/ProductionQueuePage";
import { usePollingRevalidation } from "~/hooks/use-polling-revalidation";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Production — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "production_queue.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const { filters, sort } = parseProductionQueueSearchParams(url.searchParams);
  const pageParam = Number(url.searchParams.get("page") ?? "0");
  const page = Number.isFinite(pageParam) && pageParam >= 0 ? pageParam : 0;

  const [queue, assignableStaff, savedViews] = await Promise.all([
    loadProductionQueue({
      shopId: staffUser.shopId,
      currentStaffUserId: staffUser.id,
      filters,
      sort,
      page,
    }),
    getAssignableStaff(staffUser.shopId),
    listGenericSavedViews(staffUser.id, PRODUCTION_SAVED_VIEW_SCOPE),
  ]);

  return {
    filters,
    sort,
    page,
    queue,
    assignableStaff,
    savedViews,
    currentParams: Object.fromEntries(url.searchParams),
    currentStaffUserId: staffUser.id,
    canAssign: hasPermission(staffUser, "production_jobs.assign"),
    canStart: hasPermission(staffUser, "production_jobs.start"),
    canPause: hasPermission(staffUser, "production_jobs.pause"),
    canComplete: hasPermission(staffUser, "production_jobs.complete"),
    canReopen: hasPermission(staffUser, "production_jobs.reopen"),
    canUpdateQuantities: hasPermission(staffUser, "production_quantities.update"),
    canPerformQualityCheck: hasPermission(staffUser, "production_quality_check.perform"),
    canCreateIssues: hasPermission(staffUser, "production_issues.create"),
    canResolveIssues: hasPermission(staffUser, "production_issues.resolve"),
    canCreateNotes: hasPermission(staffUser, "production_notes.create"),
  };
}

export default function ProductionQueueRoute({ loaderData }: Route.ComponentProps) {
  usePollingRevalidation();
  return (
    <>
      <ProductionQueuePage {...loaderData} />
      {/* The job drawer (routes/production.$jobId.tsx) renders here as a fixed
          overlay when its URL segment is active — the queue underneath stays
          mounted and doesn't re-fetch, matching orders.tsx's own drawer pattern. */}
      <Outlet />
    </>
  );
}
