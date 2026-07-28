import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from "~/domain/orders/saved-views.server";
import { EMPTY_BOARD_FILTERS } from "~/domain/orders/board-filters";

describe("saved views (integration)", () => {
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

  const baseConfig = {
    filters: EMPTY_BOARD_FILTERS,
    sort: { field: "urgency_default" as const },
    view: "board" as const,
    density: "comfortable" as const,
  };

  it("creates, lists, updates, and deletes a staff member's own saved view", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await createStaffUser();

    const created = await createSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      name: "My urgent view",
      config: baseConfig,
      isDefault: false,
    });
    createdViewIds.push(created.id);
    expect(created.name).toBe("My urgent view");

    const listed = await listSavedViews(staffUser.id);
    expect(listed.map((v) => v.id)).toContain(created.id);

    const updateResult = await updateSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      viewId: created.id,
      name: "Renamed view",
      isDefault: true,
    });
    expect(updateResult.outcome).toBe("updated");
    if (updateResult.outcome === "updated") {
      expect(updateResult.view.name).toBe("Renamed view");
      expect(updateResult.view.isDefault).toBe(true);
    }

    const deleteResult = await deleteSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      viewId: created.id,
    });
    expect(deleteResult.outcome).toBe("deleted");

    const afterDelete = await listSavedViews(staffUser.id);
    expect(afterDelete.map((v) => v.id)).not.toContain(created.id);
  });

  it("prevents one staff member from updating another's saved view", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const owner = await createStaffUser();
    const intruder = await createStaffUser();

    const view = await createSavedView({
      staffUserId: owner.id,
      shopId: shop.id,
      name: "Owner's view",
      config: baseConfig,
      isDefault: false,
    });
    createdViewIds.push(view.id);

    const result = await updateSavedView({
      staffUserId: intruder.id,
      shopId: shop.id,
      viewId: view.id,
      name: "Hijacked name",
    });
    expect(result.outcome).toBe("forbidden");

    const unchanged = await db.savedView.findUniqueOrThrow({ where: { id: view.id } });
    expect(unchanged.name).toBe("Owner's view");
  });

  it("prevents one staff member from deleting another's saved view", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const owner = await createStaffUser();
    const intruder = await createStaffUser();

    const view = await createSavedView({
      staffUserId: owner.id,
      shopId: shop.id,
      name: "Owner's other view",
      config: baseConfig,
      isDefault: false,
    });
    createdViewIds.push(view.id);

    const result = await deleteSavedView({
      staffUserId: intruder.id,
      shopId: shop.id,
      viewId: view.id,
    });
    expect(result.outcome).toBe("forbidden");

    expect(await db.savedView.findUnique({ where: { id: view.id } })).not.toBeNull();
  });

  it("setting a new default clears isDefault on the staff member's other views", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await createStaffUser();

    const first = await createSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      name: "First",
      config: baseConfig,
      isDefault: true,
    });
    createdViewIds.push(first.id);

    const second = await createSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      name: "Second",
      config: baseConfig,
      isDefault: true,
    });
    createdViewIds.push(second.id);

    const firstRow = await db.savedView.findUniqueOrThrow({ where: { id: first.id } });
    const secondRow = await db.savedView.findUniqueOrThrow({ where: { id: second.id } });
    expect(firstRow.isDefault).toBe(false);
    expect(secondRow.isDefault).toBe(true);
  });

  it("falls back safely after deleting the current default — no default remains, nothing throws", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await createStaffUser();

    const view = await createSavedView({
      staffUserId: staffUser.id,
      shopId: shop.id,
      name: "Only default",
      config: baseConfig,
      isDefault: true,
    });
    createdViewIds.push(view.id);

    await deleteSavedView({ staffUserId: staffUser.id, shopId: shop.id, viewId: view.id });

    const remaining = await listSavedViews(staffUser.id);
    expect(remaining.some((v) => v.isDefault)).toBe(false);
  });
});
