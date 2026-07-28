import type { Route } from "./+types/orders.$orderId.more";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { loadMoreActivity, loadMoreNotes } from "~/domain/orders/order-detail-query.server";

// Resource route backing the drawer's "load more" buttons for Notes and
// Activity — kept separate so orders.$orderId.tsx's own loader always
// returns one consistent shape (matches the orders/column pattern from
// Milestone 06B).
export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "orders.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const section = url.searchParams.get("section");
  const cursorId = url.searchParams.get("cursor");

  if (!cursorId) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Missing cursor", { status: 400 });
  }

  if (section === "notes") {
    if (!hasPermission(staffUser, "notes.internal.view")) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
      throw new Response("Forbidden", { status: 403 });
    }
    return loadMoreNotes({ shopId: staffUser.shopId, orderId: params.orderId, cursorId });
  }

  if (section === "activity") {
    return loadMoreActivity({ shopId: staffUser.shopId, orderId: params.orderId, cursorId });
  }

  // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
  throw new Response("Unknown section", { status: 400 });
}
