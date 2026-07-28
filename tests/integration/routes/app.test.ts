import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { IntegrationFailureStatus, IntegrationType, Severity } from "@prisma/client";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { loader } from "~/routes/app";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/dashboard");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("app layout route (integration)", () => {
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

  it("redirects signed-out requests to /login", async () => {
    let caught: unknown;
    try {
      await loader({
        request: new Request("http://localhost/dashboard"),
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

  it("returns the staff user and a real unresolved-issue count for a signed-in request", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const role = await db.role.findUniqueOrThrow({
      where: { shopId_name: { shopId: shop.id, name: "ADMINISTRATOR" } },
    });
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name: "Test Admin",
        passwordHash: await hashPassword("irrelevant"),
      },
    });
    createdStaffUserIds.push(staffUser.id);
    await db.staffRole.create({ data: { staffUserId: staffUser.id, roleId: role.id } });

    const failure = await db.integrationFailure.create({
      data: {
        shopId: shop.id,
        integration: IntegrationType.SHOPIFY_ORDER_IMPORT,
        action: `test-action-${randomUUID()}`,
        summary: "test failure",
        severity: Severity.LOW,
        status: IntegrationFailureStatus.NEW,
      },
    });
    createdFailureIds.push(failure.id);

    const cookie = await sessionCookieFor(staffUser.id);
    const result = await loader({
      request: new Request("http://localhost/dashboard", { headers: { Cookie: cookie } }),
      params: {},
      context: {},
    } as never);

    expect(result.staffUser.id).toBe(staffUser.id);
    expect(result.integrationIssueCount).toBeGreaterThanOrEqual(1);
  });
});
