import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { NoteVisibility } from "@prisma/client";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { loader } from "~/routes/orders.$orderId.more";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/orders");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("order drawer 'load more' resource route (integration)", () => {
  const createdStaffUserIds: string[] = [];
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.orderNote.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffRole.deleteMany({ where: { staffUserId: { in: createdStaffUserIds } } });
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
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
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  async function createOrderWithNotes(count: number, authorId: string) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#more-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
      },
    });
    createdOrderIds.push(order.id);
    for (let i = 0; i < count; i++) {
      await db.orderNote.create({
        data: {
          orderId: order.id,
          authorStaffId: authorId,
          body: `Note ${i}`,
          visibility: NoteVisibility.INTERNAL,
          createdAt: new Date(Date.now() - (count - i) * 1000),
        },
      });
    }
    return order;
  }

  it("returns 403 for a staff user without orders.view", async () => {
    const staffUser = await createStaffUserWithRole("PACKING_STAFF");
    const order = await createOrderWithNotes(1, staffUser.id);
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      loader({
        request: new Request(`http://localhost/orders/${order.id}/more?section=notes&cursor=x`, {
          headers: { Cookie: cookie },
        }),
        params: { orderId: order.id },
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns 400 when the cursor is missing", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const order = await createOrderWithNotes(1, staffUser.id);
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      loader({
        request: new Request(`http://localhost/orders/${order.id}/more?section=notes`, {
          headers: { Cookie: cookie },
        }),
        params: { orderId: order.id },
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("returns 403 for section=notes when the staff user lacks notes.internal.view", async () => {
    const staffUser = await createStaffUserWithRole("PRINT_STAFF");
    const order = await createOrderWithNotes(1, staffUser.id);
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      loader({
        request: new Request(`http://localhost/orders/${order.id}/more?section=notes&cursor=x`, {
          headers: { Cookie: cookie },
        }),
        params: { orderId: order.id },
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("pages through notes past the first cursor", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const order = await createOrderWithNotes(25, staffUser.id);
    const cookie = await sessionCookieFor(staffUser.id);

    const notes = await db.orderNote.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
    });
    const cursorId = notes[19]?.id ?? "";

    const result = (await loader({
      request: new Request(
        `http://localhost/orders/${order.id}/more?section=notes&cursor=${cursorId}`,
        {
          headers: { Cookie: cookie },
        },
      ),
      params: { orderId: order.id },
      context: {},
    } as never)) as { notes: unknown[]; hasMore: boolean };

    expect(result.notes.length).toBe(5);
    expect(result.hasMore).toBe(false);
  });

  it("returns 400 for an unknown section", async () => {
    const staffUser = await createStaffUserWithRole("MANAGER");
    const order = await createOrderWithNotes(1, staffUser.id);
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      loader({
        request: new Request(`http://localhost/orders/${order.id}/more?section=unknown&cursor=x`, {
          headers: { Cookie: cookie },
        }),
        params: { orderId: order.id },
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});
