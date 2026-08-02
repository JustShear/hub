import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { loader as queueLoader } from "~/routes/warehouse";
import { action as actionsAction } from "~/routes/warehouse.actions";
import { loader as jobDetailLoader } from "~/routes/warehouse.$jobId";
import { createWarehouseTestTracker } from "~/../tests/integration/domain/warehouse/helpers";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/warehouse");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("warehouse routes (integration)", () => {
  const tracker = createWarehouseTestTracker();
  const createdStaffRoleUserIds: string[] = [];
  afterAll(async () => {
    await tracker.cleanup();
    if (createdStaffRoleUserIds.length > 0) {
      await db.staffRole.deleteMany({ where: { staffUserId: { in: createdStaffRoleUserIds } } });
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffRoleUserIds } } });
    }
  });

  async function createStaffUserWithRole(roleName: string) {
    const shop = await db.shop.findFirstOrThrow();
    const role = await db.role.findUniqueOrThrow({
      where: { shopId_name: { shopId: shop.id, name: roleName } },
    });
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Staff",
        passwordHash: await hashPassword("irrelevant"),
      },
    });
    await db.staffRole.create({ data: { staffUserId: staffUser.id, roleId: role.id } });
    createdStaffRoleUserIds.push(staffUser.id);
    return staffUser;
  }

  async function seedPickJob() {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id, 5);
    const pickJob = await tracker.completeOrderProduction({
      shopId: order.shopId,
      orderId: order.id,
      orderLineId: line.id,
      quantity: 5,
      staffUserId: staffUser.id,
    });
    const item = await db.warehousePickItem.findFirstOrThrow({
      where: { warehousePickJobId: pickJob.id },
    });
    return { order, staffUser, pickJob, item };
  }

  describe("/warehouse queue loader", () => {
    it("redirects a signed-out request to /login", async () => {
      let caught: unknown;
      try {
        await queueLoader({
          request: new Request("http://localhost/warehouse"),
          params: {},
          context: {},
        } as never);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Response);
      expect((caught as Response).status).toBe(302);
    });

    it("returns 403 for a staff user with no roles at all", async () => {
      const shop = await db.shop.findFirstOrThrow();
      const staffUser = await db.staffUser.create({
        data: {
          shopId: shop.id,
          email: `test-${randomUUID()}@example.com`,
          name: "No Roles",
          passwordHash: await hashPassword("irrelevant"),
        },
      });
      createdStaffRoleUserIds.push(staffUser.id);
      const cookie = await sessionCookieFor(staffUser.id);

      let caught: unknown;
      try {
        await queueLoader({
          request: new Request("http://localhost/warehouse", { headers: { Cookie: cookie } }),
          params: {},
          context: {},
        } as never);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Response);
      expect((caught as Response).status).toBe(403);
    });

    it("returns queue data and permission booleans for a Manager", async () => {
      const manager = await createStaffUserWithRole("MANAGER");
      const cookie = await sessionCookieFor(manager.id);

      const result = (await queueLoader({
        request: new Request("http://localhost/warehouse", { headers: { Cookie: cookie } }),
        params: {},
        context: {},
      } as never)) as { queue: { cards: unknown[] }; canHandover: boolean };

      expect(result.queue).toBeDefined();
      expect(Array.isArray(result.queue.cards)).toBe(true);
      expect(result.canHandover).toBe(true);
    });

    it("returns queue access for Packing Staff too, with handover permission but view/download-scoped elsewhere", async () => {
      const packingStaff = await createStaffUserWithRole("PACKING_STAFF");
      const cookie = await sessionCookieFor(packingStaff.id);

      const result = (await queueLoader({
        request: new Request("http://localhost/warehouse", { headers: { Cookie: cookie } }),
        params: {},
        context: {},
      } as never)) as { canResolveIssues: boolean };

      expect(result.canResolveIssues).toBe(false);
    });
  });

  describe("/warehouse/actions", () => {
    it("returns 403 without warehouse_picks.view even for a recognised intent", async () => {
      const shop = await db.shop.findFirstOrThrow();
      const staffUser = await db.staffUser.create({
        data: {
          shopId: shop.id,
          email: `test-${randomUUID()}@example.com`,
          name: "No Roles",
          passwordHash: await hashPassword("irrelevant"),
        },
      });
      createdStaffRoleUserIds.push(staffUser.id);
      const cookie = await sessionCookieFor(staffUser.id);
      const formData = new FormData();
      formData.set("_intent", "recordQuantity");

      let caught: unknown;
      try {
        await actionsAction({
          request: new Request("http://localhost/warehouse/actions", {
            method: "POST",
            headers: { Cookie: cookie },
            body: formData,
          }),
          params: {},
          context: {},
        } as never);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Response);
      expect((caught as Response).status).toBe(403);
    });

    it("rejects resolveIssue for Packing Staff, who has view/record/mark_short/handover but not issues.resolve", async () => {
      const { pickJob } = await seedPickJob();
      const packingStaff = await createStaffUserWithRole("PACKING_STAFF");
      const cookie = await sessionCookieFor(packingStaff.id);
      const issue = await db.warehouseIssue.create({
        data: {
          shopId: pickJob.shopId,
          orderId: pickJob.orderId,
          warehousePickJobId: pickJob.id,
          issueType: "OTHER",
          severity: "LOW",
          description: "Test issue",
          isBlocking: false,
          createdByStaffId: packingStaff.id,
        },
      });
      const formData = new FormData();
      formData.set("_intent", "resolveIssue");
      formData.set("warehouseIssueId", issue.id);
      formData.set("resolutionNote", "Resolved");

      const result = (await actionsAction({
        request: new Request("http://localhost/warehouse/actions", {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: {},
        context: {},
      } as never)) as { ok: boolean; error?: string };

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/permission/i);
    });

    it("performs a valid recordQuantity action for Packing Staff", async () => {
      const { pickJob, item } = await seedPickJob();
      const packingStaff = await createStaffUserWithRole("PACKING_STAFF");
      const cookie = await sessionCookieFor(packingStaff.id);
      const formData = new FormData();
      formData.set("_intent", "recordQuantity");
      formData.set("warehousePickItemId", item.id);
      formData.set("newlyPickedQuantity", "5");
      formData.set("idempotencyKey", randomUUID());

      const result = (await actionsAction({
        request: new Request("http://localhost/warehouse/actions", {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: {},
        context: {},
      } as never)) as { ok: boolean; pickedQuantity?: number };

      expect(result.ok).toBe(true);
      expect(result.pickedQuantity).toBe(5);
      const refreshed = await db.warehousePickItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(refreshed.status).toBe("PICKED");

      // And handover, also permitted for Packing Staff.
      const handoverFormData = new FormData();
      handoverFormData.set("_intent", "handoverJob");
      handoverFormData.set("warehousePickJobId", pickJob.id);
      const handoverResult = (await actionsAction({
        request: new Request("http://localhost/warehouse/actions", {
          method: "POST",
          headers: { Cookie: cookie },
          body: handoverFormData,
        }),
        params: {},
        context: {},
      } as never)) as { ok: boolean };
      expect(handoverResult.ok).toBe(true);
    });

    it("returns an unknown-intent error for an unrecognised _intent", async () => {
      const manager = await createStaffUserWithRole("MANAGER");
      const cookie = await sessionCookieFor(manager.id);
      const formData = new FormData();
      formData.set("_intent", "somethingElse");

      const result = (await actionsAction({
        request: new Request("http://localhost/warehouse/actions", {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: {},
        context: {},
      } as never)) as { ok: boolean; intent: string };

      expect(result.ok).toBe(false);
      expect(result.intent).toBe("unknown");
    });
  });

  describe("/warehouse/:jobId loader", () => {
    it("returns 404 for a job that doesn't exist", async () => {
      const manager = await createStaffUserWithRole("MANAGER");
      const cookie = await sessionCookieFor(manager.id);

      let caught: unknown;
      try {
        await jobDetailLoader({
          request: new Request("http://localhost/warehouse/not-a-real-job", {
            headers: { Cookie: cookie },
          }),
          params: { jobId: "not-a-real-job" },
          context: {},
        } as never);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Response);
      expect((caught as Response).status).toBe(404);
    });

    it("returns the job detail with items for a valid job", async () => {
      const { pickJob } = await seedPickJob();
      const manager = await createStaffUserWithRole("MANAGER");
      const cookie = await sessionCookieFor(manager.id);

      const result = (await jobDetailLoader({
        request: new Request(`http://localhost/warehouse/${pickJob.id}`, {
          headers: { Cookie: cookie },
        }),
        params: { jobId: pickJob.id },
        context: {},
      } as never)) as { job: { id: string; items: unknown[] } };

      expect(result.job.id).toBe(pickJob.id);
      expect(result.job.items.length).toBe(1);
    });
  });
});
