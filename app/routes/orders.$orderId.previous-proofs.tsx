import type { Route } from "./+types/orders.$orderId.previous-proofs";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { loadPreviousAcceptedProofs } from "~/domain/customers/customer-query.server";

// Resource route behind the Overview tab's "Previously accepted proofs"
// strip. Loaded lazily by the drawer after it opens, so it never adds to the
// time the drawer itself takes to appear.
export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (
    !hasPermission(staffUser, "orders.view") ||
    !hasPermission(staffUser, "proof_versions.view")
  ) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  return loadPreviousAcceptedProofs({ shopId: staffUser.shopId, orderId: params.orderId });
}
