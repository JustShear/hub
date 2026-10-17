import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession, requireStaffUser } from "~/auth/staff-session.server";

async function cookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/dashboard");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("requireStaffUser per-request memoisation (integration)", () => {
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
  });

  async function createStaffUser() {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `memo-${randomUUID()}@example.com`,
        name: "Memo Test",
        passwordHash: "irrelevant",
      },
    });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  it("resolves the user once per Request — loaders sharing a request share one lookup", async () => {
    const staffUser = await createStaffUser();
    const request = new Request("http://localhost/orders/abc", {
      headers: { Cookie: await cookieFor(staffUser.id) },
    });

    const [a, b, c] = await Promise.all([
      requireStaffUser(request),
      requireStaffUser(request),
      requireStaffUser(request),
    ]);

    expect(a.id).toBe(staffUser.id);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("never reuses a result across different requests (a later request sees fresh data)", async () => {
    const staffUser = await createStaffUser();
    const cookie = await cookieFor(staffUser.id);

    const first = await requireStaffUser(new Request("http://localhost/a", { headers: { Cookie: cookie } }));
    await db.staffUser.update({ where: { id: staffUser.id }, data: { name: "Renamed" } });
    const second = await requireStaffUser(new Request("http://localhost/b", { headers: { Cookie: cookie } }));

    expect(first.name).toBe("Memo Test");
    expect(second.name).toBe("Renamed");
  });

  it("a deactivated user is rejected on the very next request", async () => {
    const staffUser = await createStaffUser();
    const cookie = await cookieFor(staffUser.id);
    await requireStaffUser(new Request("http://localhost/a", { headers: { Cookie: cookie } }));
    await db.staffUser.update({ where: { id: staffUser.id }, data: { isActive: false } });

    await expect(
      requireStaffUser(new Request("http://localhost/b", { headers: { Cookie: cookie } })),
    ).rejects.toBeInstanceOf(Response);
  });
});
