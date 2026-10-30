import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProofVersionStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { loadCustomerProofFile, listCustomers } from "~/domain/customers/customer-query.server";

describe("customer queries (integration)", () => {
  const runId = randomUUID().slice(0, 8);
  const customerId = `9${Date.now()}`;
  const email = `proof-file-${runId}@example.test`;
  const orderIds: string[] = [];
  let shopId: string;

  beforeAll(async () => {
    shopId = (await db.shop.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    const groups = await db.proofGroup.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const versions = await db.proofVersion.findMany({
      where: { proofGroupId: { in: groups.map((g) => g.id) } },
      select: { id: true },
    });
    const versionIds = versions.map((v) => v.id);
    await db.customerProofResponse.deleteMany({ where: { proofVersionId: { in: versionIds } } });
    await db.proofRequest.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.proofAsset.deleteMany({ where: { proofVersionId: { in: versionIds } } });
    await db.proofVersion.deleteMany({ where: { id: { in: versionIds } } });
    await db.proofGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
    await db.shopifyOrder.deleteMany({ where: { id: { in: orderIds } } });
  });

  async function makeOrder(
    orderNumber: string,
    overrides: { customerShopifyGid?: string | null; customerEmail?: string | null } = {},
  ) {
    const order = await db.shopifyOrder.create({
      data: {
        shopId,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber,
        shopifyCreatedAt: new Date(),
        rawPayload: {},
        customerName: "Pat Customer",
        customerShopifyGid:
          overrides.customerShopifyGid === undefined
            ? `gid://shopify/Customer/${customerId}`
            : overrides.customerShopifyGid,
        customerEmail: overrides.customerEmail === undefined ? email : overrides.customerEmail,
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function makeGroup(
    orderId: string,
    name: string,
    versions: { status: ProofVersionStatus; withAsset?: boolean }[],
    groupStatus: "APPROVED" | "CANCELLED" | "CHANGES_REQUESTED" = "APPROVED",
  ) {
    const group = await db.proofGroup.create({
      data: { orderId, name, decorationMethod: "EMBROIDERY", status: groupStatus },
    });
    const created = [];
    let n = 1;
    for (const v of versions) {
      const version = await db.proofVersion.create({
        data: {
          proofGroupId: group.id,
          versionNumber: n++,
          status: v.status,
          createdByStaffId: "staff",
          approvedAt: v.status === "APPROVED" ? new Date() : null,
        },
      });
      const asset =
        v.withAsset === false
          ? null
          : await db.proofAsset.create({
              data: {
                proofVersionId: version.id,
                storageKey: `test/${randomUUID()}.png`,
                isPrimary: true,
                mimeType: "image/png",
              },
            });
      created.push({ version, asset });
    }
    return { group, created };
  }

  it("lists a customer once however many orders they have, and finds them by name or email", async () => {
    await makeOrder(`#CQ-${runId}-1`);
    await makeOrder(`#CQ-${runId}-2`);

    const byEmail = await listCustomers({ shopId, search: email });
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0]).toMatchObject({
      key: `s-${customerId}`,
      name: "Pat Customer",
      email,
      orderCount: 2,
    });

    const byOrderNumber = await listCustomers({ shopId, search: `#CQ-${runId}-2` });
    expect(byOrderNumber.map((c) => c.key)).toEqual([`s-${customerId}`]);

    expect(await listCustomers({ shopId, search: `nobody-${runId}-zzz` })).toEqual([]);
  });

  it("returns null for a customer with no orders", async () => {
    const result = await loadCustomerProofFile({
      shopId,
      identity: { kind: "shopify", shopifyCustomerId: "1" + customerId },
    });
    expect(result).toBeNull();
  });

  it("shows the final approved proof per group and every changes-requested version", async () => {
    const order = await makeOrder(`#CQ-${runId}-3`);
    // v1 changes requested, v2 changes requested, v3 approved -> one accepted, two history rows.
    const { created } = await makeGroup(order.id, "Left chest", [
      { status: "CHANGES_REQUESTED" },
      { status: "CHANGES_REQUESTED" },
      { status: "APPROVED" },
    ]);
    // A second group still waiting on changes: not accepted, not "since approved".
    const open = await makeGroup(
      order.id,
      "Back print",
      [{ status: "CHANGES_REQUESTED" }],
      "CHANGES_REQUESTED",
    );

    // A customer response carrying the reason for the first change request.
    const request = await db.proofRequest.create({
      data: {
        shopId,
        orderId: order.id,
        customerEmail: email,
        tokenHash: randomUUID(),
        tokenExpiresAt: new Date(Date.now() + 86_400_000),
        createdByStaffId: "staff",
      },
    });
    await db.customerProofResponse.create({
      data: {
        proofRequestId: request.id,
        proofVersionId: created[0]?.version.id ?? "",
        responseType: "CHANGES_REQUESTED",
        customerNote: "Please make the logo bigger",
        changeCategories: ["SIZE"],
        idempotencyKey: randomUUID(),
      },
    });

    const file = await loadCustomerProofFile({
      shopId,
      identity: { kind: "shopify", shopifyCustomerId: customerId },
    });
    expect(file).not.toBeNull();

    const accepted = file?.accepted.filter((c) => c.orderId === order.id) ?? [];
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      groupName: "Left chest",
      versionNumber: 3,
      orderNumber: `#CQ-${runId}-3`,
      assetId: created[2]?.asset?.id,
    });

    const changes = file?.changesRequested.filter((c) => c.orderId === order.id) ?? [];
    expect(changes).toHaveLength(3);
    const first = changes.find((c) => c.versionNumber === 1);
    expect(first).toMatchObject({
      customerNote: "Please make the logo bigger",
      categories: ["SIZE"],
      laterApproved: true,
    });
    expect(changes.find((c) => c.versionNumber === 2)?.laterApproved).toBe(true);
    expect(changes.find((c) => c.groupName === "Back print")).toMatchObject({
      versionNumber: 1,
      laterApproved: false,
      assetId: open.created[0]?.asset?.id,
    });
  });

  it("ignores cancelled proof groups and tolerates a version with no file", async () => {
    const order = await makeOrder(`#CQ-${runId}-4`);
    await makeGroup(order.id, "Cancelled group", [{ status: "APPROVED" }], "CANCELLED");
    await makeGroup(order.id, "No file", [{ status: "APPROVED", withAsset: false }]);

    const file = await loadCustomerProofFile({
      shopId,
      identity: { kind: "shopify", shopifyCustomerId: customerId },
    });
    const forOrder = file?.accepted.filter((c) => c.orderId === order.id) ?? [];
    expect(forOrder.map((c) => c.groupName)).toEqual(["No file"]);
    expect(forOrder[0]?.assetId).toBeNull();
  });

  it("finds a guest customer by email, case-insensitively, and never mixes in other customers", async () => {
    const guestEmail = `guest-${runId}@example.test`;
    const guestOrder = await makeOrder(`#CQ-${runId}-5`, {
      customerShopifyGid: null,
      customerEmail: guestEmail,
    });
    await makeGroup(guestOrder.id, "Guest logo", [{ status: "APPROVED" }]);

    const file = await loadCustomerProofFile({
      shopId,
      identity: { kind: "email", email: guestEmail.toUpperCase().toLowerCase() },
    });
    expect(file?.customer.orderCount).toBe(1);
    expect(file?.accepted.map((c) => c.groupName)).toEqual(["Guest logo"]);
  });

  it("is scoped to the shop", async () => {
    const result = await loadCustomerProofFile({
      shopId: "another-shop",
      identity: { kind: "shopify", shopifyCustomerId: customerId },
    });
    expect(result).toBeNull();
  });
});
