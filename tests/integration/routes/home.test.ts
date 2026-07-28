import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { loader } from "~/routes/home";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/dashboard");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("home route (integration)", () => {
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdStaffUserIds.length > 0) {
      await db.staffRole.deleteMany({ where: { staffUserId: { in: createdStaffUserIds } } });
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  it("redirects signed-out requests to /login", async () => {
    let caught: unknown;
    try {
      await loader({ request: new Request("http://localhost/"), params: {}, context: {} } as never);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(302);
    expect((caught as Response).headers.get("Location")).toContain("/login");
  });

  it("redirects signed-in requests to /dashboard", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Staff",
        passwordHash: await hashPassword("irrelevant"),
      },
    });
    createdStaffUserIds.push(staffUser.id);
    const cookie = await sessionCookieFor(staffUser.id);

    let caught: unknown;
    try {
      await loader({
        request: new Request("http://localhost/", { headers: { Cookie: cookie } }),
        params: {},
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(302);
    expect((caught as Response).headers.get("Location")).toBe("/dashboard");
  });
});
