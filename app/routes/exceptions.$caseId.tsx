import type { Route } from "./+types/exceptions.$caseId";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { loadExceptionCaseDetail } from "~/domain/exceptions/exception-case-detail-query.server";
import { getAssignableStaff } from "~/domain/orders/order-detail-query.server";
import { ExceptionCaseDrawer } from "~/components/exceptions/ExceptionCaseDrawer";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `Order ${loaderData.detail.exceptionCase.order.orderNumber}, case ${loaderData.detail.exceptionCase.caseNumber} — Just Shear Production Hub`,
    },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "exception_cases.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const detail = await loadExceptionCaseDetail({
    shopId: staffUser.shopId,
    exceptionCaseId: params.caseId,
  });
  if (!detail) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Exception case not found", { status: 404 });
  }

  const assignableStaff = await getAssignableStaff(staffUser.shopId);

  return {
    detail,
    assignableStaff,
    canUpdate: hasPermission(staffUser, "exception_cases.update"),
    canAssign: hasPermission(staffUser, "exception_cases.assign"),
    canResolve: hasPermission(staffUser, "exception_cases.resolve"),
    canCancel: hasPermission(staffUser, "exception_cases.cancel"),
    canCreateNotes: hasPermission(staffUser, "exception_notes.create"),
  };
}

export default function ExceptionCaseRoute({ loaderData }: Route.ComponentProps) {
  return <ExceptionCaseDrawer {...loaderData} />;
}
