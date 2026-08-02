// @vitest-environment node
//
// This route action test constructs a real multipart Request (File +
// FormData) to exercise the file-upload intent end to end. The suite's
// default jsdom environment provides its own File/FormData classes that are
// not brand-compatible with the Request implementation's multipart
// serializer, so this file opts back into Node's native fetch globals —
// the same realm the route actually runs in during production.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUserSession } from "~/auth/staff-session.server";
import { hashPassword } from "~/auth/password.server";
import { action } from "~/routes/orders.$orderId.proof-groups";
import { createProofTestTracker, PNG_BYTES } from "~/../tests/integration/domain/proofs/helpers";

async function sessionCookieFor(staffUserId: string): Promise<string> {
  const response = await createUserSession(staffUserId, "/orders");
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("expected a Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("order proof-groups action route (integration)", () => {
  const tracker = createProofTestTracker();
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
    formData.set("_intent", "createProofGroup");

    let caught: unknown;
    try {
      await action({
        request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
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
    formData.set("_intent", "createProofGroup");

    await expect(
      action({
        request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: formData,
        }),
        params: { orderId: order.id },
        context: {},
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects createProofGroup for a staff user without proof_groups.create (view-only Print Staff)", async () => {
    const order = await tracker.createOrder();
    const staffUser = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(staffUser.id);
    const formData = new FormData();
    formData.set("_intent", "createProofGroup");
    formData.set("name", "Left chest embroidery");
    formData.set("decorationMethod", "EMBROIDERY");
    formData.set("requirement", "UNDETERMINED");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(await db.proofGroup.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("performs a valid createProofGroup action for Manager", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);
    const formData = new FormData();
    formData.set("_intent", "createProofGroup");
    formData.set("name", "Left chest embroidery");
    formData.set("decorationMethod", "EMBROIDERY");
    formData.set("placement", "Left chest");
    formData.set("requirement", "UNDETERMINED");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(await db.proofGroup.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("performs a valid createProofVersion action with a real multipart file upload", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);

    const createGroupForm = new FormData();
    createGroupForm.set("_intent", "createProofGroup");
    createGroupForm.set("name", "Full back print");
    createGroupForm.set("decorationMethod", "SCREEN_PRINT");
    createGroupForm.set("placement", "Full back");
    createGroupForm.set("requirement", "UNDETERMINED");
    const createGroupResult = (await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: createGroupForm,
      }),
      params: { orderId: order.id },
      context: {},
    } as never)) as { ok: true; proofGroupId: string };
    expect(createGroupResult.ok).toBe(true);

    const uploadForm = new FormData();
    uploadForm.set("_intent", "createProofVersion");
    uploadForm.set("proofGroupId", createGroupResult.proofGroupId);
    uploadForm.set("file", new File([PNG_BYTES], "proof.png", { type: "image/png" }));

    const uploadResult = await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: uploadForm,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(uploadResult).toMatchObject({ ok: true, versionNumber: 1 });
    expect(
      await db.proofVersion.count({ where: { proofGroupId: createGroupResult.proofGroupId } }),
    ).toBe(1);
  });

  it("rejects createProofVersion when no file is attached", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);
    const staffUser = await tracker.createStaffUser();
    const group = await db.proofGroup.create({
      data: {
        orderId: order.id,
        name: "Test",
        decorationMethod: "EMBROIDERY",
        placement: "Left chest",
      },
    });

    const formData = new FormData();
    formData.set("_intent", "createProofVersion");
    formData.set("proofGroupId", group.id);

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    void staffUser;
  });

  it("rejects sendProofRequest for a staff user without proof_requests.create (view-only Print Staff)", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const { proofGroupId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: staffUser.id,
    });
    const printStaff = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(printStaff.id);
    const formData = new FormData();
    formData.set("_intent", "sendProofRequest");
    formData.set("proofGroupId", proofGroupId);

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(await db.proofRequest.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("performs a valid sendProofRequest action for Manager", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const { proofGroupId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: manager.id,
    });
    const cookie = await sessionCookieFor(manager.id);
    const formData = new FormData();
    formData.set("_intent", "sendProofRequest");
    formData.set("proofGroupId", proofGroupId);
    formData.set("staffMessage", "Please review when you get a chance.");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    expect(await db.proofRequest.count({ where: { orderId: order.id } })).toBe(1);
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("SENT");
  });

  it("rejects manuallyApproveProofVersion for a staff user without proof_responses.override (view-only Print Staff)", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const { proofGroupId, proofVersionId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: manager.id,
    });
    await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: await sessionCookieFor(manager.id) },
        body: (() => {
          const formData = new FormData();
          formData.set("_intent", "sendProofRequest");
          formData.set("proofGroupId", proofGroupId);
          return formData;
        })(),
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    const printStaff = await createStaffUserWithRole("PRINT_STAFF");
    const cookie = await sessionCookieFor(printStaff.id);
    const formData = new FormData();
    formData.set("_intent", "manuallyApproveProofVersion");
    formData.set("proofVersionId", proofVersionId);
    formData.set("reason", "Customer called to approve");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: false });
    const version = await db.proofVersion.findUniqueOrThrow({ where: { id: proofVersionId } });
    expect(version.status).toBe("SENT");
  });

  it("performs a valid manuallyApproveProofVersion action for Manager", async () => {
    const order = await tracker.createOrder();
    const manager = await createStaffUserWithRole("MANAGER");
    const cookie = await sessionCookieFor(manager.id);
    const { proofGroupId, proofVersionId } = await tracker.createReadyGroup({
      orderId: order.id,
      shopId: order.shopId,
      staffUserId: manager.id,
    });
    await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: (() => {
          const formData = new FormData();
          formData.set("_intent", "sendProofRequest");
          formData.set("proofGroupId", proofGroupId);
          return formData;
        })(),
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    const formData = new FormData();
    formData.set("_intent", "manuallyApproveProofVersion");
    formData.set("proofVersionId", proofVersionId);
    formData.set("reason", "Customer called to approve");

    const result = await action({
      request: new Request(`http://localhost/orders/${order.id}/proof-groups`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
      }),
      params: { orderId: order.id },
      context: {},
    } as never);

    expect(result).toMatchObject({ ok: true });
    const version = await db.proofVersion.findUniqueOrThrow({ where: { id: proofVersionId } });
    expect(version.status).toBe("APPROVED");
  });
});
