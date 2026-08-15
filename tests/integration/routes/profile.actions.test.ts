import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { action } from "~/routes/profile.actions";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/dashboard");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("profile.actions route (integration)", () => {
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
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

  it("lets any signed-in staff member set their own theme — no permission gate", async () => {
    const staffUser = await createStaffUser();
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "setTheme");
    formData.set("theme", "DARK");

    const result = (await action({
      request: new Request("http://localhost/profile/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never)) as { ok: boolean };

    expect(result.ok).toBe(true);
    const updated = await db.staffUser.findUniqueOrThrow({ where: { id: staffUser.id } });
    expect(updated.theme).toBe("DARK");
  });

  it("rejects an unknown theme value", async () => {
    const staffUser = await createStaffUser();
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "setTheme");
    formData.set("theme", "NEON");

    const result = (await action({
      request: new Request("http://localhost/profile/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never)) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    const unchanged = await db.staffUser.findUniqueOrThrow({ where: { id: staffUser.id } });
    expect(unchanged.theme).toBe("CLASSIC");
  });

  it("returns an unknown-intent error for an unrecognised _intent", async () => {
    const staffUser = await createStaffUser();
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "somethingElse");

    const result = (await action({
      request: new Request("http://localhost/profile/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never)) as { intent: string; ok: boolean };

    expect(result).toMatchObject({ intent: "unknown", ok: false });
  });
});
