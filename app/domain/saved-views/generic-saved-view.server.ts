import { ActorType } from "@prisma/client";
import { db } from "~/lib/db.server";

/**
 * A saved view for any queue whose filters/sort already live entirely in
 * the URL's search params (Production, Warehouse, Exceptions) — unlike the
 * Kanban board (see ~/domain/orders/saved-views.server.ts), these queues
 * have no shared filter shape worth modelling as a typed schema, so a
 * saved view here is simply "the query string that reproduces this exact
 * view," stored verbatim as a flat string map in the same SavedView.filters
 * Json column, partitioned by `scope` from the board's own rows.
 */
export interface GenericSavedViewSummary {
  id: string;
  name: string;
  isDefault: boolean;
  params: Record<string, string>;
}

function toGenericSummary(row: {
  id: string;
  name: string;
  isDefault: boolean;
  filters: unknown;
}): GenericSavedViewSummary {
  const params: Record<string, string> = {};
  if (row.filters && typeof row.filters === "object" && !Array.isArray(row.filters)) {
    for (const [key, value] of Object.entries(row.filters as Record<string, unknown>)) {
      if (typeof value === "string") params[key] = value;
    }
  }
  return { id: row.id, name: row.name, isDefault: row.isDefault, params };
}

export async function listGenericSavedViews(
  staffUserId: string,
  scope: string,
): Promise<GenericSavedViewSummary[]> {
  const rows = await db.savedView.findMany({
    where: { staffUserId, scope },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(toGenericSummary);
}

export interface CreateGenericSavedViewInput {
  staffUserId: string;
  shopId: string;
  scope: string;
  name: string;
  params: Record<string, string>;
  isDefault: boolean;
}

export async function createGenericSavedView(
  input: CreateGenericSavedViewInput,
): Promise<GenericSavedViewSummary> {
  if (input.isDefault) {
    await db.savedView.updateMany({
      where: { staffUserId: input.staffUserId, scope: input.scope },
      data: { isDefault: false },
    });
  }

  const created = await db.savedView.create({
    data: {
      staffUserId: input.staffUserId,
      scope: input.scope,
      name: input.name,
      isDefault: input.isDefault,
      filters: input.params,
      sortOrder: {},
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

  return toGenericSummary(created);
}

export interface UpdateGenericSavedViewInput {
  staffUserId: string;
  shopId: string;
  viewId: string;
  name?: string;
  params?: Record<string, string>;
  isDefault?: boolean;
}

export type GenericSavedViewMutationResult =
  | { outcome: "updated"; view: GenericSavedViewSummary }
  | { outcome: "not_found" }
  | { outcome: "forbidden" };

async function findOwnedView(staffUserId: string, viewId: string) {
  const view = await db.savedView.findUnique({ where: { id: viewId } });
  if (!view) return { status: "not_found" as const };
  if (view.staffUserId !== staffUserId) return { status: "forbidden" as const };
  return { status: "ok" as const, view };
}

export async function updateGenericSavedView(
  input: UpdateGenericSavedViewInput,
): Promise<GenericSavedViewMutationResult> {
  const found = await findOwnedView(input.staffUserId, input.viewId);
  if (found.status === "not_found") return { outcome: "not_found" };
  if (found.status === "forbidden") return { outcome: "forbidden" };

  if (input.isDefault) {
    await db.savedView.updateMany({
      where: { staffUserId: input.staffUserId, scope: found.view.scope },
      data: { isDefault: false },
    });
  }

  const updated = await db.savedView.update({
    where: { id: input.viewId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.params !== undefined ? { filters: input.params } : {}),
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

  return { outcome: "updated", view: toGenericSummary(updated) };
}

export interface DeleteGenericSavedViewInput {
  staffUserId: string;
  shopId: string;
  viewId: string;
}

export type DeleteGenericSavedViewResult =
  { outcome: "deleted" } | { outcome: "not_found" } | { outcome: "forbidden" };

export async function deleteGenericSavedView(
  input: DeleteGenericSavedViewInput,
): Promise<DeleteGenericSavedViewResult> {
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
