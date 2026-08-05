import { Outlet } from "react-router";
import type { BoardColumnKey } from "~/domain/orders/board-columns";
import type { Route } from "./+types/orders";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import {
  parseBoardSearchParams,
  savedViewConfigInputSchema,
  type SavedViewConfig,
} from "~/domain/orders/board-filters";
import {
  loadBoardColumns,
  loadSpecialView,
  getBoardFilterOptions,
} from "~/domain/orders/board-query.server";
import { moveOrderWorkflowStatus } from "~/domain/orders/move-order-workflow-status.server";
import { updateOrderNeedsPrinting } from "~/domain/orders/update-needs-printing.server";
import {
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
} from "~/domain/orders/saved-views.server";
import { BoardPage } from "~/components/board/BoardPage";
import { formString } from "~/lib/form-data";
import { usePollingRevalidation } from "~/hooks/use-polling-revalidation";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Orders — Just Shear Production Hub" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "board.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const { filters, sort, view, visibleColumns } = parseBoardSearchParams(url.searchParams);
  const canManage = hasPermission(staffUser, "board.manage");

  const board =
    view === "board"
      ? await loadBoardColumns({
          shopId: staffUser.shopId,
          filters,
          sort,
          currentStaffUserId: staffUser.id,
        })
      : null;
  const special =
    view !== "board"
      ? await loadSpecialView({
          shopId: staffUser.shopId,
          view,
          filters,
          currentStaffUserId: staffUser.id,
        })
      : null;

  const [filterOptions, savedViews] = await Promise.all([
    getBoardFilterOptions(staffUser.shopId),
    listSavedViews(staffUser.id),
  ]);

  return {
    view,
    filters,
    sort,
    visibleColumns,
    canManage,
    canViewIntegrations: hasPermission(staffUser, "integrations.view"),
    canCreateFreightShipments: hasPermission(staffUser, "freight_shipments.create"),
    board,
    special,
    filterOptions,
    savedViews,
    currentStaffUserId: staffUser.id,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const staffUser = await requireStaffUser(request);

  if (!hasPermission(staffUser, "board.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "move") {
    if (!hasPermission(staffUser, "board.manage")) {
      return {
        intent: "move" as const,
        ok: false,
        error: "You don't have permission to move orders.",
      };
    }
    const orderId = formString(formData, "orderId");
    const targetColumnKeyRaw = formString(formData, "targetColumnKey");
    const expectedWorkflowStatusRaw = formString(formData, "expectedWorkflowStatus");
    if (!orderId || !targetColumnKeyRaw || !expectedWorkflowStatusRaw) {
      return { intent: "move" as const, ok: false, error: "Missing move parameters." };
    }
    const targetColumnKey = targetColumnKeyRaw as BoardColumnKey;

    const result = await moveOrderWorkflowStatus({
      shopId: staffUser.shopId,
      orderId,
      targetColumnKey,
      // Cast is safe: moveOrderWorkflowStatus compares this against the real
      // enum value read from the database and rejects any mismatch.
      expectedWorkflowStatus: expectedWorkflowStatusRaw as never,
      staffUserId: staffUser.id,
    });

    if (result.outcome === "rejected" || result.outcome === "conflict") {
      return { intent: "move" as const, ok: false, error: result.reason };
    }
    return { intent: "move" as const, ok: true, workflowStatus: result.workflowStatus };
  }

  if (intent === "toggleNeedsPrinting") {
    if (!hasPermission(staffUser, "board.manage")) {
      return {
        intent: "toggleNeedsPrinting" as const,
        ok: false,
        error: "You don't have permission to update this order.",
      };
    }
    const orderId = formString(formData, "orderId");
    const needsPrinting = formString(formData, "needsPrinting") === "true";
    if (!orderId) {
      return { intent: "toggleNeedsPrinting" as const, ok: false, error: "Missing orderId." };
    }

    const result = await updateOrderNeedsPrinting({
      shopId: staffUser.shopId,
      orderId,
      needsPrinting,
      staffUserId: staffUser.id,
    });

    if (result.outcome === "rejected") {
      return { intent: "toggleNeedsPrinting" as const, ok: false, error: result.reason };
    }
    return {
      intent: "toggleNeedsPrinting" as const,
      ok: true,
      needsPrinting: result.needsPrinting,
    };
  }

  if (intent === "createView" || intent === "updateView") {
    const name = formString(formData, "name").trim();
    const isDefault = formData.get("isDefault") === "1";
    const configRaw = formString(formData, "config") || "{}";
    let config: SavedViewConfig;
    try {
      config = savedViewConfigInputSchema.parse(JSON.parse(configRaw));
    } catch {
      return { intent, ok: false, error: "That saved view's settings couldn't be read." };
    }
    if (!name) {
      return { intent, ok: false, error: "A view name is required." };
    }

    if (intent === "createView") {
      const view = await createSavedView({
        staffUserId: staffUser.id,
        shopId: staffUser.shopId,
        name,
        config,
        isDefault,
      });
      return { intent: "createView" as const, ok: true, view };
    }

    const viewId = formString(formData, "viewId");
    const result = await updateSavedView({
      staffUserId: staffUser.id,
      shopId: staffUser.shopId,
      viewId,
      name,
      config,
      isDefault,
    });
    if (result.outcome !== "updated") {
      return {
        intent: "updateView" as const,
        ok: false,
        error:
          result.outcome === "forbidden"
            ? "You can't edit another staff member's saved view."
            : "Saved view not found.",
      };
    }
    return { intent: "updateView" as const, ok: true, view: result.view };
  }

  if (intent === "deleteView") {
    const viewId = formString(formData, "viewId");
    const result = await deleteSavedView({
      staffUserId: staffUser.id,
      shopId: staffUser.shopId,
      viewId,
    });
    if (result.outcome !== "deleted") {
      return {
        intent: "deleteView" as const,
        ok: false,
        error:
          result.outcome === "forbidden"
            ? "You can't delete another staff member's saved view."
            : "Saved view not found.",
      };
    }
    return { intent: "deleteView" as const, ok: true };
  }

  return { intent: "unknown" as const, ok: false, error: "Unknown action." };
}

export default function OrdersBoard({ loaderData }: Route.ComponentProps) {
  usePollingRevalidation();
  return (
    <>
      <BoardPage {...loaderData} />
      {/* The order drawer (routes/orders.$orderId.tsx) renders here as a fixed
          overlay when its URL segment is active — the board underneath stays
          mounted and doesn't re-fetch, so opening the drawer never disturbs it. */}
      <Outlet />
    </>
  );
}
