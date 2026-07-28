import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { IntegrationFailureStatus, IntegrationType, Severity } from "@prisma/client";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { loader } from "~/routes/integrations";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/integrations");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("integrations route (integration)", () => {
  const createdStaffUserIds: string[] = [];
  const createdFailureIds: string[] = [];

  afterAll(async () => {
    if (createdFailureIds.length > 0) {
      await db.integrationFailure.deleteMany({ where: { id: { in: createdFailureIds } } });
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

  it("redirects signed-out requests to /login", async () => {
    let caught: unknown;
    try {
      await loader({
        request: new Request("http://localhost/integrations"),
        params: {},
        context: {},
      } as never);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Response);
    expect((caught as Response).status).toBe(302);
    expect((caught as Response).headers.get("Location")).toContain("/login");
  });

  it("returns 403 for a signed-in staff user without integrations.view", async () => {
    const staffUser = await createStaffUserWithRole("PACKING_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);

    await expect(
      loader({
        request: new Request("http://localhost/integrations", { headers: { Cookie: cookie } }),
        params: {},
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("lists only unresolved failures for a staff user with integrations.view", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(staffUser.id);

    const open = await db.integrationFailure.create({
      data: {
        shopId: shop.id,
        integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
        action: `test-action-${randomUUID()}`,
        summary: "Open failure — should appear",
        severity: Severity.HIGH,
        status: IntegrationFailureStatus.NEEDS_ATTENTION,
      },
    });
    const resolved = await db.integrationFailure.create({
      data: {
        shopId: shop.id,
        integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
        action: `test-action-${randomUUID()}`,
        summary: "Resolved failure — should not appear",
        severity: Severity.LOW,
        status: IntegrationFailureStatus.RESOLVED,
      },
    });
    createdFailureIds.push(open.id, resolved.id);

    const result = await loader({
      request: new Request("http://localhost/integrations", { headers: { Cookie: cookie } }),
      params: {},
      context: {},
    } as never);

    const summaries = result.failures.map((f) => f.summary);
    expect(summaries).toContain("Open failure — should appear");
    expect(summaries).not.toContain("Resolved failure — should not appear");
  });
});
