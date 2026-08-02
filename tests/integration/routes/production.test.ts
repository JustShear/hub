import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { loader as queueLoader } from "~/routes/production";
import { action as actionsAction } from "~/routes/production.actions";
import { loader as jobDetailLoader } from "~/routes/production.$jobId";
import { createProductionArtwork } from "~/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "~/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "~/domain/production/mark-production-artwork-ready.server";
import { createExportBatch } from "~/domain/production/create-export-batch.server";
import {
  createProductionTestTracker,
  PDF_BYTES,
} from "~/../tests/integration/domain/production/helpers";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/production");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("production routes (integration)", () => {
  const tracker = createProductionTestTracker();
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

  async function seedExportedJob() {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const proofGroupId = await tracker.createNoProofRequiredGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
      orderLineId: line.id,
    });
    const artwork = await createProductionArtwork({
      shopId: order.shopId,
      proofGroupId,
      fileBuffer: PDF_BYTES,
      originalFilename: "artwork.pdf",
      decorationMethod: null,
      placement: "Front badge",
      productionMetadata: null,
      staffUserId: staffUser.id,
      idempotencyKey: null,
    });
    if (artwork.outcome !== "created") throw new Error("setup failed");
    await setProductionArtworkOrderLines({
      shopId: order.shopId,
      productionArtworkId: artwork.productionArtworkId,
      allocations: [{ orderLineId: line.id, quantity: line.quantity }],
      staffUserId: staffUser.id,
    });
    await markProductionArtworkReady({
      shopId: order.shopId,
      productionArtworkId: artwork.productionArtworkId,
      staffUserId: staffUser.id,
    });
    const exportResult = await createExportBatch({
      shopId: order.shopId,
      orderId: order.id,
      proofGroupIds: [proofGroupId],
      destination: null,
      staffUserId: staffUser.id,
      idempotencyKey: randomUUID(),
    });
    if (exportResult.outcome !== "exported") throw new Error("setup failed");
    const job = await db.productionJob.findFirstOrThrow({
      where: { exportBatchId: exportResult.exportBatchId },
    });
    return { order, staffUser, job };
  }

  describe("/production queue loader", () => {
    it("redirects a signed-out request to /login", async () => {
      let caught: unknown;
      try {
        await queueLoader({
          request: new Request("http://localhost/production"),
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
          request: new Request("http://localhost/production", { headers: { Cookie: cookie } }),
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
        request: new Request("http://localhost/production", { headers: { Cookie: cookie } }),
        params: {},
        context: {},
      } as never)) as { queue: { cards: unknown[] }; canCreateNotes: boolean };

      expect(result.queue).toBeDefined();
      expect(Array.isArray(result.queue.cards)).toBe(true);
      expect(result.canCreateNotes).toBe(true);
    });
  });

  describe("/production/actions", () => {
    it("returns 403 without production_queue.view even for a recognised intent", async () => {
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
      formData.set("_intent", "createNote");

      let caught: unknown;
      try {
        await actionsAction({
          request: new Request("http://localhost/production/actions", {
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

    it("rejects createProductionJobs for a staff user without production_jobs.create", async () => {
      const printStaff = await createStaffUserWithRole("PRINT_STAFF");
      const cookie = await sessionCookieFor(printStaff.id);
      const formData = new FormData();
      formData.set("_intent", "createProductionJobs");
      formData.set("exportBatchId", "irrelevant");

      const result = (await actionsAction({
        request: new Request("http://localhost/production/actions", {
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

    it("performs a valid startTask action for a print staff member", async () => {
      const { job } = await seedExportedJob();
      const task = await db.productionTask.findFirstOrThrow({ where: { productionJobId: job.id } });
      const printStaff = await createStaffUserWithRole("PRINT_STAFF");
      const cookie = await sessionCookieFor(printStaff.id);
      const formData = new FormData();
      formData.set("_intent", "startTask");
      formData.set("productionTaskId", task.id);

      const result = (await actionsAction({
        request: new Request("http://localhost/production/actions", {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: {},
        context: {},
      } as never)) as { ok: boolean };

      expect(result.ok).toBe(true);
      const refreshed = await db.productionTask.findUniqueOrThrow({ where: { id: task.id } });
      expect(refreshed.status).toBe("IN_PROGRESS");
    });
  });

  describe("/production/:jobId loader", () => {
    it("returns 404 for a job that doesn't exist", async () => {
      const manager = await createStaffUserWithRole("MANAGER");
      const cookie = await sessionCookieFor(manager.id);

      let caught: unknown;
      try {
        await jobDetailLoader({
          request: new Request("http://localhost/production/not-a-real-job", {
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

    it("returns the job detail with tasks for a valid job", async () => {
      const { job } = await seedExportedJob();
      const manager = await createStaffUserWithRole("MANAGER");
      const cookie = await sessionCookieFor(manager.id);

      const result = (await jobDetailLoader({
        request: new Request(`http://localhost/production/${job.id}`, {
          headers: { Cookie: cookie },
        }),
        params: { jobId: job.id },
        context: {},
      } as never)) as { job: { id: string; tasks: unknown[] } };

      expect(result.job.id).toBe(job.id);
      expect(result.job.tasks.length).toBe(1);
    });
  });
});
