import type { Route } from "./+types/warehouse.$jobId";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { loadWarehousePickJobDetail } from "~/domain/warehouse/pick-job-detail-query.server";
import { getAssignableStaff } from "~/domain/orders/order-detail-query.server";
import { WarehousePickJobDrawer } from "~/components/warehouse/WarehousePickJobDrawer";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `Order ${loaderData.job.order.orderNumber} pick — Just Shear Production Hub` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "warehouse_picks.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const detail = await loadWarehousePickJobDetail({
    shopId: staffUser.shopId,
    jobId: params.jobId,
  });
  if (!detail) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Warehouse pick job not found", { status: 404 });
  }

  const assignableStaff = await getAssignableStaff(staffUser.shopId);

  return {
    ...detail,
    assignableStaff,
    canAssign: hasPermission(staffUser, "warehouse_picks.assign"),
    canRecordQuantity: hasPermission(staffUser, "warehouse_picks.record_quantity"),
    canMarkShort: hasPermission(staffUser, "warehouse_picks.mark_short"),
    canHandover: hasPermission(staffUser, "warehouse_picks.handover"),
    canCreateIssues: hasPermission(staffUser, "warehouse_issues.create"),
    canResolveIssues: hasPermission(staffUser, "warehouse_issues.resolve"),
    canCreateNotes: hasPermission(staffUser, "warehouse_notes.create"),
  };
}

export default function WarehousePickJobRoute({ loaderData }: Route.ComponentProps) {
  return <WarehousePickJobDrawer {...loaderData} />;
}
