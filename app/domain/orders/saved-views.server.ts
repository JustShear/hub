import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  boardSortSchema,
  savedViewFiltersColumnSchema,
  type SavedViewConfig,
} from "~/domain/orders/board-filters";

export interface SavedViewSummary {
  id: string;
  name: string;
  isDefault: boolean;
  config: SavedViewConfig;
}

// SavedView.filters/sortOrder are Json — never trust them back without
// re-validating, even though they're the staff member's own prior input
// (schema drift between app versions is a realistic way for stale data to
// creep in). Falls back to safe defaults rather than throwing on a
// corrupted row so one bad saved view can't break the whole board.
function toSummary(row: {
  id: string;
  name: string;
  isDefault: boolean;
  filters: unknown;
  sortOrder: unknown;
}): SavedViewSummary {
  const filtersColumn = savedViewFiltersColumnSchema.safeParse(row.filters);
  const sort = boardSortSchema.safeParse(row.sortOrder ?? {});

  const parsedFilters = filtersColumn.success
    ? filtersColumn.data
    : savedViewFiltersColumnSchema.parse({ filters: {}, view: "board", density: "comfortable" });

  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    config: {
      filters: parsedFilters.filters,
      view: parsedFilters.view,
      visibleColumns: parsedFilters.visibleColumns,
      density: parsedFilters.density,
      sort: sort.success ? sort.data : boardSortSchema.parse({}),
    },
  };
}

export async function listSavedViews(staffUserId: string): Promise<SavedViewSummary[]> {
  const rows = await db.savedView.findMany({
    where: { staffUserId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(toSummary);
}

export interface CreateSavedViewInput {
  staffUserId: string;
  shopId: string;
  name: string;
  config: SavedViewConfig;
  isDefault: boolean;
}

export async function createSavedView(input: CreateSavedViewInput): Promise<SavedViewSummary> {
  const filtersColumn = savedViewFiltersColumnSchema.parse({
    filters: input.config.filters,
    view: input.config.view,
    visibleColumns: input.config.visibleColumns,
    density: input.config.density,
  });
  const sortOrder = boardSortSchema.parse(input.config.sort);

  if (input.isDefault) {
    await db.savedView.updateMany({
      where: { staffUserId: input.staffUserId },
      data: { isDefault: false },
    });
  }

  const created = await db.savedView.create({
    data: {
      staffUserId: input.staffUserId,
      name: input.name,
      isDefault: input.isDefault,
      filters: filtersColumn,
      sortOrder,
    },
  });

  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      entityType: "SavedView",
      entityId: created.id,
      eventType: "saved_view_created",
      summary: `Saved view "${created.name}" created`,
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  return toSummary(created);
}

export interface UpdateSavedViewInput {
  staffUserId: string;
  shopId: string;
  viewId: string;
  name?: string;
  config?: SavedViewConfig;
  isDefault?: boolean;
}

export type SavedViewMutationResult =
  | { outcome: "updated"; view: SavedViewSummary }
  | { outcome: "not_found" }
  | { outcome: "forbidden" };

async function findOwnedView(staffUserId: string, viewId: string) {
  const view = await db.savedView.findUnique({ where: { id: viewId } });
  if (!view) return { status: "not_found" as const };
  if (view.staffUserId !== staffUserId) return { status: "forbidden" as const };
  return { status: "ok" as const, view };
}

export async function updateSavedView(
  input: UpdateSavedViewInput,
): Promise<SavedViewMutationResult> {
  const found = await findOwnedView(input.staffUserId, input.viewId);
  if (found.status === "not_found") return { outcome: "not_found" };
  if (found.status === "forbidden") return { outcome: "forbidden" };

  if (input.isDefault) {
    await db.savedView.updateMany({
      where: { staffUserId: input.staffUserId },
      data: { isDefault: false },
    });
  }

  const filtersColumn = input.config
    ? savedViewFiltersColumnSchema.parse({
        filters: input.config.filters,
        view: input.config.view,
        visibleColumns: input.config.visibleColumns,
        density: input.config.density,
      })
    : undefined;
  const sortOrder = input.config ? boardSortSchema.parse(input.config.sort) : undefined;

  const updated = await db.savedView.update({
    where: { id: input.viewId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(filtersColumn !== undefined ? { filters: filtersColumn } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    },
  });

  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      entityType: "SavedView",
      entityId: updated.id,
      eventType: "saved_view_updated",
      summary: `Saved view "${updated.name}" updated`,
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  return { outcome: "updated", view: toSummary(updated) };
}

export interface DeleteSavedViewInput {
  staffUserId: string;
  shopId: string;
  viewId: string;
}

export type DeleteSavedViewResult =
  { outcome: "deleted" } | { outcome: "not_found" } | { outcome: "forbidden" };

// Deleting the current default falls back safely: Prisma just leaves no row
// with isDefault=true, and listSavedViews/the board treat "no default" as
// "use the board's built-in defaults" rather than erroring.
export async function deleteSavedView(input: DeleteSavedViewInput): Promise<DeleteSavedViewResult> {
  const found = await findOwnedView(input.staffUserId, input.viewId);
  if (found.status === "not_found") return { outcome: "not_found" };
  if (found.status === "forbidden") return { outcome: "forbidden" };

  await db.savedView.delete({ where: { id: input.viewId } });

  await db.activityEvent.create({
    data: {
      shopId: input.shopId,
      entityType: "SavedView",
      entityId: input.viewId,
      eventType: "saved_view_deleted",
      summary: `Saved view "${found.view.name}" deleted`,
      actorStaffId: input.staffUserId,
      actorType: ActorType.STAFF,
    },
  });

  return { outcome: "deleted" };
}
