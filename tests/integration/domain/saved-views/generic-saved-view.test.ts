import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import {
  createGenericSavedView,
  deleteGenericSavedView,
  listGenericSavedViews,
  updateGenericSavedView,
} from "~/domain/saved-views/generic-saved-view.server";
import { createSavedView, listSavedViews } from "~/domain/orders/saved-views.server";
import { EMPTY_BOARD_FILTERS } from "~/domain/orders/board-filters";

describe("generic saved views (integration)", () => {
  const createdStaffUserIds: string[] = [];
  const createdViewIds: string[] = [];

  afterAll(async () => {
    if (createdViewIds.length > 0) {
      await db.savedView.deleteMany({ where: { id: { in: createdViewIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  async function createStaffUser() {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Staff",
        passwordHash: "irrelevant",
      },
    });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  it("creates, lists, updates, and deletes a staff member's own saved view for a given scope", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await createStaffUser();

    const created = await createGenericSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      scope: "production",
      name: "My urgent jobs",
      params: { priority: "URGENT" },
      isDefault: false,
    });
    createdViewIds.push(created.id);
    expect(created.name).toBe("My urgent jobs");
    expect(created.params).toEqual({ priority: "URGENT" });

    const listed = await listGenericSavedViews(staffUser.id, "production");
    expect(listed.map((v) => v.id)).toContain(created.id);

    const updated = await updateGenericSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      viewId: created.id,
      name: "Renamed",
      params: { priority: "HIGH" },
    });
    expect(updated.outcome).toBe("updated");
    if (updated.outcome === "updated") {
      expect(updated.view.name).toBe("Renamed");
      expect(updated.view.params).toEqual({ priority: "HIGH" });
    }

    const deleted = await deleteGenericSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      viewId: created.id,
    });
    expect(deleted.outcome).toBe("deleted");
    expect(
      (await listGenericSavedViews(staffUser.id, "production")).map((v) => v.id),
    ).not.toContain(created.id);
  });

  it("prevents one staff member from updating or deleting another's saved view", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const owner = await createStaffUser();
    const intruder = await createStaffUser();

    const view = await createGenericSavedView({
      staffUserId: owner.id,
      shopId: shop.id,
      scope: "warehouse",
      name: "Owner's view",
      params: {},
      isDefault: false,
    });
    createdViewIds.push(view.id);

    const updateResult = await updateGenericSavedView({
      staffUserId: intruder.id,
      shopId: shop.id,
      viewId: view.id,
      name: "Hijacked",
    });
    expect(updateResult.outcome).toBe("forbidden");

    const deleteResult = await deleteGenericSavedView({
      staffUserId: intruder.id,
      shopId: shop.id,
      viewId: view.id,
    });
    expect(deleteResult.outcome).toBe("forbidden");
  });

  it("scopes isDefault-clearing to the same scope, not across every queue", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await createStaffUser();

    const productionDefault = await createGenericSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      scope: "production",
      name: "Production default",
      params: {},
      isDefault: true,
    });
    createdViewIds.push(productionDefault.id);

    const warehouseDefault = await createGenericSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      scope: "warehouse",
      name: "Warehouse default",
      params: {},
      isDefault: true,
    });
    createdViewIds.push(warehouseDefault.id);

    // Creating a second default within warehouse must not clear
    // production's own default — the bug this scoping change fixes.
    const productionRow = await db.savedView.findUniqueOrThrow({
      where: { id: productionDefault.id },
    });
    const warehouseRow = await db.savedView.findUniqueOrThrow({
      where: { id: warehouseDefault.id },
    });
    expect(productionRow.isDefault).toBe(true);
    expect(warehouseRow.isDefault).toBe(true);
  });

  it("never mixes a production-scoped view into the board's own list, or vice versa", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await createStaffUser();

    const productionView = await createGenericSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      scope: "production",
      name: "Production-only view",
      params: { status: "BLOCKED" },
      isDefault: false,
    });
    createdViewIds.push(productionView.id);

    const boardView = await createSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      name: "Board-only view",
      config: {
        filters: EMPTY_BOARD_FILTERS,
        sort: { field: "urgency_default" },
        view: "board",
        density: "comfortable",
      },
      isDefault: false,
    });
    createdViewIds.push(boardView.id);

    const productionList = await listGenericSavedViews(staffUser.id, "production");
    expect(productionList.map((v) => v.id)).toContain(productionView.id);
    expect(productionList.map((v) => v.id)).not.toContain(boardView.id);

    const boardList = await listSavedViews(staffUser.id);
    expect(boardList.map((v) => v.id)).toContain(boardView.id);
    expect(boardList.map((v) => v.id)).not.toContain(productionView.id);
  });
});
