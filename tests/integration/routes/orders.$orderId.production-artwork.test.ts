// @vitest-environment node
//
// Same reasoning as orders.$orderId.proof-groups.test.ts — a real multipart
// Request (File + FormData) is constructed to exercise the upload intent
// end to end, which requires Node's native fetch globals rather than the
// suite's default jsdom environment.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { action } from "~/routes/orders.$orderId.production-artwork";
import {
  createProductionTestTracker,
  PDF_BYTES,
} from "~/../tests/integration/domain/production/helpers";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/orders");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("order production-artwork action route (integration)", () => {
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

  it("redirects a signed-out request to /login", async () => {
    const order = await tracker.createOrder();
    const formData = new FormData();
    formData.set("_intent", "createProductionArtwork");

    let caught: unknown;
    try {
      await action({
        request: new Request(`http://localhost/orders/${order.id}/production-artwork`, {
          method: "POST",
          body: formData,
        }),
        params: { orderId: order.id },
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(302);
  });

  it("returns 403 for a staff user without orders.view", async () => {
    const order = await tracker.createOrder();
    const staffUser = await createStaffUserWithRole("PACKING_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "createProductionArtwork");

    let caught: unknown;
    try {
      await action({
        request: new Request(`http://localhost/orders/${order.id}/production-artwork`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: { orderId: order.id },
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(403);
  });

  it("rejects createProductionArtwork for a staff user with orders.view but without production_artwork permissions", async () => {
    const order = await tracker.createOrder();
    const staffUser = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "createProductionArtwork");
    formData.set("proofGroupId", "irrelevant");
    formData.set("file", new File([PDF_BYTES], "artwork.pdf", { type: "application/pdf" }));

    const result = (await action({
      request: new Request(`http://localhost/orders/${order.id}/production-artwork`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission/i);
  });

  it("performs a valid createProductionArtwork action with a real multipart file upload", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);
    const line = await tracker.createOrderLine(order.id);
    const approved = await tracker.createApprovedGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: manager.id,
      orderLineId: line.id,
    });

    const formData = new FormData();
    formData.set("_intent", "createProductionArtwork");
    formData.set("proofGroupId", approved.proofGroupId);
    formData.set("placement", "Left chest");
    formData.set("file", new File([PDF_BYTES], "artwork.pdf", { type: "application/pdf" }));

    const result = (await action({
      request: new Request(`http://localhost/orders/${order.id}/production-artwork`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never)) as { ok: boolean; revisionNumber?: number };

    expect(result).toMatchObject({ ok: true, revisionNumber: 1 });
    expect(
      await db.productionArtwork.count({ where: { proofGroupId: approved.proofGroupId } }),
    ).toBe(1);
  });
});
