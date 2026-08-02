import { Outlet } from "react-router";
import type { Route } from "./+types/warehouse";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { parseWarehouseQueueSearchParams } from "~/domain/warehouse/pick-queue-filters";
import { loadWarehouseQueue } from "~/domain/warehouse/pick-queue-query.server";
import { getAssignableStaff } from "~/domain/orders/order-detail-query.server";
import { listGenericSavedViews } from "~/domain/saved-views/generic-saved-view.server";
import { WAREHOUSE_SAVED_VIEW_SCOPE } from "~/domain/saved-views/scopes";
import { WarehousePickQueuePage } from "~/components/warehouse/WarehousePickQueuePage";
import { usePollingRevalidation } from "~/hooks/use-polling-revalidation";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Warehouse — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "warehouse_picks.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const { filters, sort } = parseWarehouseQueueSearchParams(url.searchParams);
  const pageParam = Number(url.searchParams.get("page") ?? "0");
  const page = Number.isFinite(pageParam) && pageParam >= 0 ? pageParam : 0;

  const [queue, assignableStaff, savedViews] = await Promise.all([
    loadWarehouseQueue({
      shopId: staffUser.shopId,
      currentStaffUserId: staffUser.id,
      filters,
      sort,
      page,
    }),
    getAssignableStaff(staffUser.shopId),
    listGenericSavedViews(staffUser.id, WAREHOUSE_SAVED_VIEW_SCOPE),
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
    canAssign: hasPermission(staffUser, "warehouse_picks.assign"),
    canRecordQuantity: hasPermission(staffUser, "warehouse_picks.record_quantity"),
    canMarkShort: hasPermission(staffUser, "warehouse_picks.mark_short"),
    canHandover: hasPermission(staffUser, "warehouse_picks.handover"),
    canCreateIssues: hasPermission(staffUser, "warehouse_issues.create"),
    canResolveIssues: hasPermission(staffUser, "warehouse_issues.resolve"),
    canCreateNotes: hasPermission(staffUser, "warehouse_notes.create"),
  };
}

export default function WarehouseQueueRoute({ loaderData }: Route.ComponentProps) {
  usePollingRevalidation();
  return (
    <>
      <WarehousePickQueuePage {...loaderData} />
      {/* The job drawer (routes/warehouse.$jobId.tsx) renders here as a fixed
          overlay when its URL segment is active — the queue underneath stays
          mounted and doesn't re-fetch, matching production.tsx's own pattern. */}
      <Outlet />
    </>
  );
}
