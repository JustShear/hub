import { Outlet } from "react-router";
import type { Route } from "./+types/exceptions";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { parseExceptionQueueSearchParams } from "~/domain/exceptions/exception-queue-filters";
import { loadExceptionQueue } from "~/domain/exceptions/exception-queue-query.server";
import { getAssignableStaff } from "~/domain/orders/order-detail-query.server";
import { listGenericSavedViews } from "~/domain/saved-views/generic-saved-view.server";
import { EXCEPTIONS_SAVED_VIEW_SCOPE } from "~/domain/saved-views/scopes";
import { ExceptionQueuePage } from "~/components/exceptions/ExceptionQueuePage";
import { usePollingRevalidation } from "~/hooks/use-polling-revalidation";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Exceptions — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "exception_cases.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const { filters, sort } = parseExceptionQueueSearchParams(url.searchParams);
  const pageParam = Number(url.searchParams.get("page") ?? "0");
  const page = Number.isFinite(pageParam) && pageParam >= 0 ? pageParam : 0;

  const [queue, assignableStaff, savedViews] = await Promise.all([
    loadExceptionQueue({
      shopId: staffUser.shopId,
      currentStaffUserId: staffUser.id,
      filters,
      sort,
      page,
    }),
    getAssignableStaff(staffUser.shopId),
    listGenericSavedViews(staffUser.id, EXCEPTIONS_SAVED_VIEW_SCOPE),
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
    canCreate: hasPermission(staffUser, "exception_cases.create"),
    canUpdate: hasPermission(staffUser, "exception_cases.update"),
    canAssign: hasPermission(staffUser, "exception_cases.assign"),
    canResolve: hasPermission(staffUser, "exception_cases.resolve"),
    canCancel: hasPermission(staffUser, "exception_cases.cancel"),
    canCreateNotes: hasPermission(staffUser, "exception_notes.create"),
  };
}

export default function ExceptionsQueueRoute({ loaderData }: Route.ComponentProps) {
  usePollingRevalidation();
  return (
    <>
      <ExceptionQueuePage {...loaderData} />
      {/* The case drawer (routes/exceptions.$caseId.tsx) renders here as a
          fixed overlay when its URL segment is active — the queue underneath
          stays mounted and doesn't re-fetch, matching production.tsx's/
          warehouse.tsx's own pattern. */}
      <Outlet />
    </>
  );
}
