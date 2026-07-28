import type { BoardColumnKey } from "~/domain/orders/board-columns";
import type { Route } from "./+types/orders.column";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { parseBoardSearchParams } from "~/domain/orders/board-filters";
import { loadMoreForColumn } from "~/domain/orders/board-query.server";

// Resource route backing the board's "Load more" button — kept separate
// from orders.tsx so that route's loader always returns one consistent
// shape instead of a union of "full board" / "one column's next page".
export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "board.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const { filters, sort } = parseBoardSearchParams(url.searchParams);
  const columnKey = url.searchParams.get("columnKey") as BoardColumnKey | null;
  if (!columnKey) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Missing columnKey", { status: 400 });
  }

  const cursorId = url.searchParams.get("cursor") ?? undefined;
  const offsetParam = url.searchParams.get("offset");
  const offset = offsetParam ? Number(offsetParam) : undefined;

  return loadMoreForColumn({
    shopId: staffUser.shopId,
    columnKey,
    filters,
    sort,
    currentStaffUserId: staffUser.id,
    cursorId,
    offset,
  });
}
