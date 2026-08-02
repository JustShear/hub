import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { action } from "~/routes/exceptions.actions";
import { createExceptionTestTracker } from "~/../tests/integration/domain/exceptions/helpers";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/exceptions");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("exceptions.actions route (integration)", () => {
  const tracker = createExceptionTestTracker();
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

  it("allows Print Staff to create an exception case", async () => {
    const order = await tracker.createOrder();
    const printStaff = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(printStaff.id);
    const formData = new FormData();
    formData.set("_intent", "createExceptionCase");
    formData.set("orderId", order.id);
    formData.set("category", "PRODUCTION_DEFECT");
    formData.set("initiatedBy", "STAFF");
    formData.set("summary", "Noticed a print defect during QC");

    const result = (await action({
      request: new Request("http://localhost/exceptions/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: {},
      context: {},
    } as never)) as { ok: true; exceptionCaseId: string };

    expect(result.ok).toBe(true);
    tracker.trackExceptionCase(result.exceptionCaseId);
  });

  it("rejects resolveExceptionCase for Print Staff (view/create only, not resolve)", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const managerCookie = await sessionCookieFor(manager.id);
    const createForm = new FormData();
    createForm.set("_intent", "createExceptionCase");
    createForm.set("orderId", order.id);
    createForm.set("category", "OTHER");
    createForm.set("initiatedBy", "STAFF");
    createForm.set("summary", "Something to resolve");
    const createResult = (await action({
      request: new Request("http://localhost/exceptions/actions", {
        method: "POST",
        headers: { Cookie: managerCookie },
        body: createForm,
      }),
      params: {},
      context: {},
    } as never)) as { ok: true; exceptionCaseId: string };
    expect(createResult.ok).toBe(true);
    tracker.trackExceptionCase(createResult.exceptionCaseId);

    const printStaff = await createStaffUserWithRole("PRINT_STAFF");
    const printCookie = await sessionCookieFor(printStaff.id);
    const resolveForm = new FormData();
    resolveForm.set("_intent", "resolveExceptionCase");
    resolveForm.set("exceptionCaseId", createResult.exceptionCaseId);
    resolveForm.set("resolutionType", "DENIED");
    resolveForm.set("reason", "No fault found");

    const resolveResult = await action({
      request: new Request("http://localhost/exceptions/actions", {
        method: "POST",
        headers: { Cookie: printCookie },
        body: resolveForm,
      }),
      params: {},
      context: {},
    } as never);
    expect(resolveResult).toMatchObject({ ok: false });

    const stillOpen = await db.exceptionCase.findUniqueOrThrow({
      where: { id: createResult.exceptionCaseId },
    });
    expect(stillOpen.status).toBe("OPEN");
  });

  it("performs a valid resolveExceptionCase (DENIED) for Manager", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);
    const createForm = new FormData();
    createForm.set("_intent", "createExceptionCase");
    createForm.set("orderId", order.id);
    createForm.set("category", "WARRANTY_CLAIM");
    createForm.set("initiatedBy", "CUSTOMER");
    createForm.set("summary", "Customer reports stitching came undone");
    const createResult = (await action({
      request: new Request("http://localhost/exceptions/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: createForm,
      }),
      params: {},
      context: {},
    } as never)) as { ok: true; exceptionCaseId: string };
    expect(createResult.ok).toBe(true);
    tracker.trackExceptionCase(createResult.exceptionCaseId);

    const resolveForm = new FormData();
    resolveForm.set("_intent", "resolveExceptionCase");
    resolveForm.set("exceptionCaseId", createResult.exceptionCaseId);
    resolveForm.set("resolutionType", "DENIED");
    resolveForm.set("reason", "Outside warranty period");

    const resolveResult = await action({
      request: new Request("http://localhost/exceptions/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: resolveForm,
      }),
      params: {},
      context: {},
    } as never);
    expect(resolveResult).toMatchObject({ ok: true });

    const resolved = await db.exceptionCase.findUniqueOrThrow({
      where: { id: createResult.exceptionCaseId },
    });
    expect(resolved.status).toBe("RESOLVED");
  });
});
