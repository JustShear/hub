import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProofGroupStatus, ProofVersionStatus } from "@prisma/client";
import { db } from "~/lib/db.server";

vi.mock("~/domain/orders/sync-order-lifecycle-tag.server", () => ({
  syncOrderLifecycleTag: vi.fn(() => Promise.resolve({ outcome: "synced" })),
}));

const { syncOrderLifecycleTag } = await import("~/domain/orders/sync-order-lifecycle-tag.server");
const { applyReusedProofsForOrder, undoReusedProof, isReusedProofPropertyName } =
  await import("~/domain/proofs/reuse-previous-proof.server");

describe("reuse-previous-proof (integration)", () => {
  const runId = randomUUID().slice(0, 8);
  const customerA = `gid://shopify/Customer/6${Date.now()}`;
  const customerB = `gid://shopify/Customer/5${Date.now()}`;
  const orderIds: string[] = [];
  let shopId: string;

  beforeAll(async () => {
    shopId = (await db.shop.findFirstOrThrow()).id;
  });

  beforeEach(() => {
    vi.mocked(syncOrderLifecycleTag).mockClear();
  });

  afterAll(async () => {
    const groups = await db.proofGroup.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const groupIds = groups.map((g) => g.id);
    const versions = await db.proofVersion.findMany({
      where: { proofGroupId: { in: groupIds } },
      select: { id: true },
    });
    const versionIds = versions.map((v) => v.id);
    const lines = await db.shopifyOrderLine.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const lineIds = lines.map((l) => l.id);
    await db.proofAsset.deleteMany({ where: { proofVersionId: { in: versionIds } } });
    await db.proofVersion.deleteMany({ where: { id: { in: versionIds } } });
    await db.proofGroupOrderLine.deleteMany({ where: { proofGroupId: { in: groupIds } } });
    await db.proofRequirement.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.proofGroup.deleteMany({ where: { id: { in: groupIds } } });
    await db.activityEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.shopifyLineProperty.deleteMany({ where: { orderLineId: { in: lineIds } } });
    await db.shopifyOrderLine.deleteMany({ where: { id: { in: lineIds } } });
    await db.shopifyOrder.deleteMany({ where: { id: { in: orderIds } } });
  });

  async function makeOrder(label: string, customerGid: string | null) {
    const order = await db.shopifyOrder.create({
      data: {
        shopId,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#RU-${runId}-${label}`,
        shopifyCreatedAt: new Date(),
        rawPayload: {},
        customerShopifyGid: customerGid,
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function makeApprovedProof(
    orderId: string,
    options: {
      groupStatus?: ProofGroupStatus;
      versionStatus?: ProofVersionStatus;
      assets?: number;
    } = {},
  ) {
    const group = await db.proofGroup.create({
      data: {
        orderId,
        name: "Left chest logo",
        decorationMethod: "EMBROIDERY",
        placement: "Left chest",
        status: options.groupStatus ?? "APPROVED",
      },
    });
    const version = await db.proofVersion.create({
      data: {
        proofGroupId: group.id,
        versionNumber: 3,
        status: options.versionStatus ?? "APPROVED",
        createdByStaffId: "staff",
        approvedAt: new Date(),
      },
    });
    for (let i = 0; i < (options.assets ?? 1); i += 1) {
      await db.proofAsset.create({
        data: {
          proofVersionId: version.id,
          storageKey: `proof-versions/${randomUUID()}.png`,
          isPrimary: i === 0,
          sortOrder: i,
          mimeType: "image/png",
          originalFilename: `proof-${i}.png`,
          sizeBytes: 1234,
          checksum: "abc",
          width: 100,
          height: 80,
        },
      });
    }
    return { group, version };
  }

  async function makeTargetOrder(
    label: string,
    customerGid: string | null,
    propertyName: string,
    propertyValue: string,
  ) {
    const order = await makeOrder(label, customerGid);
    const line = await db.shopifyOrderLine.create({
      data: {
        orderId: order.id,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Polo",
        quantity: 4,
        properties: { create: [{ name: propertyName, value: propertyValue }] },
      },
    });
    return { order, line };
  }

  it("recognises the property name, with or without a field label", () => {
    expect(isReusedProofPropertyName("_previous_proof")).toBe(true);
    expect(isReusedProofPropertyName("_previous_proof: Logo")).toBe(true);
    expect(isReusedProofPropertyName(" _Previous_Proof ")).toBe(true);
    expect(isReusedProofPropertyName("_upload_token: Logo")).toBe(false);
    expect(isReusedProofPropertyName("Logo")).toBe(false);
  });

  it("creates an already-approved proof group that reuses the earlier artwork, and tags the order", async () => {
    const source = await makeOrder("src1", customerA);
    const { version } = await makeApprovedProof(source.id, { assets: 2 });
    const { order, line } = await makeTargetOrder(
      "tgt1",
      customerA,
      "_previous_proof: Logo",
      version.id,
    );

    const result = await applyReusedProofsForOrder({ shopId, orderId: order.id });
    expect(result).toEqual({ created: 1, ignored: 0 });

    const groups = await db.proofGroup.findMany({
      where: { orderId: order.id },
      include: {
        orderLines: true,
        versions: { include: { assets: true } },
        proofRequirement: true,
      },
    });
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group).toMatchObject({
      name: "Reorder: Left chest logo",
      decorationMethod: "EMBROIDERY",
      placement: "Left chest",
      status: "APPROVED",
    });
    expect(group?.orderLines.map((l) => [l.orderLineId, l.quantity])).toEqual([[line.id, 4]]);
    expect(group?.proofRequirement?.value).toBe("REQUIRED");

    const copy = group?.versions[0];
    expect(copy).toMatchObject({
      status: "APPROVED",
      versionNumber: 1,
      reusedFromVersionId: version.id,
    });
    expect(copy?.approvedAt).not.toBeNull();
    // Same stored files, new rows.
    const sourceAssets = await db.proofAsset.findMany({ where: { proofVersionId: version.id } });
    expect(copy?.assets.map((a) => a.storageKey).sort()).toEqual(
      sourceAssets.map((a) => a.storageKey).sort(),
    );
    expect(copy?.assets.find((a) => a.isPrimary)?.mimeType).toBe("image/png");

    const reloaded = await db.shopifyOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { activity: true },
    });
    expect(["PARTIALLY_APPROVED", "ALL_REQUIRED_PROOFS_APPROVED"]).toContain(reloaded.proofSummary);
    expect(reloaded.activity.some((e) => e.eventType === "proof_group_reused")).toBe(true);

    expect(syncOrderLifecycleTag).toHaveBeenCalledWith({
      shopId,
      orderId: order.id,
      addTag: "proof_accepted",
      removeTags: ["proof_sent", "proof_rejected"],
    });
  });

  it("is idempotent across re-imports", async () => {
    const source = await makeOrder("src2", customerA);
    const { version } = await makeApprovedProof(source.id);
    const { order } = await makeTargetOrder("tgt2", customerA, "_previous_proof", version.id);

    await applyReusedProofsForOrder({ shopId, orderId: order.id });
    const second = await applyReusedProofsForOrder({ shopId, orderId: order.id });

    expect(second).toEqual({ created: 0, ignored: 0 });
    expect(await db.proofGroup.count({ where: { orderId: order.id } })).toBe(1);
  });

  it.each([
    [
      "another customer's proof",
      async () => ({ customer: customerB, versionStatus: "APPROVED" as const }),
    ],
    [
      "a proof that isn't approved",
      async () => ({ customer: customerA, versionStatus: "SENT" as const }),
    ],
  ])("ignores %s and says so in the activity log", async (_label, build) => {
    const { customer, versionStatus } = await build();
    const source = await makeOrder(`src-ign-${randomUUID().slice(0, 4)}`, customer);
    const { version } = await makeApprovedProof(source.id, { versionStatus });
    const { order } = await makeTargetOrder(
      `tgt-ign-${randomUUID().slice(0, 4)}`,
      customerA,
      "_previous_proof",
      version.id,
    );

    const result = await applyReusedProofsForOrder({ shopId, orderId: order.id });

    expect(result).toEqual({ created: 0, ignored: 1 });
    expect(await db.proofGroup.count({ where: { orderId: order.id } })).toBe(0);
    const events = await db.activityEvent.findMany({ where: { orderId: order.id } });
    expect(events.some((e) => e.eventType === "proof_reuse_ignored")).toBe(true);
    expect(syncOrderLifecycleTag).not.toHaveBeenCalled();
  });

  it("ignores a made-up id, a cancelled source group, a guest order and a proof from the same order", async () => {
    // made-up id
    const a = await makeTargetOrder("tgt-fake", customerA, "_previous_proof", "cl-not-a-real-id");
    expect(await applyReusedProofsForOrder({ shopId, orderId: a.order.id })).toEqual({
      created: 0,
      ignored: 1,
    });

    // cancelled source group
    const srcCancelled = await makeOrder("src-cx", customerA);
    const cancelled = await makeApprovedProof(srcCancelled.id, { groupStatus: "CANCELLED" });
    const b = await makeTargetOrder("tgt-cx", customerA, "_previous_proof", cancelled.version.id);
    expect((await applyReusedProofsForOrder({ shopId, orderId: b.order.id })).created).toBe(0);

    // guest order (no customer on the target) can't match anyone's proof
    const srcGuest = await makeOrder("src-guest", customerA);
    const guestProof = await makeApprovedProof(srcGuest.id);
    const c = await makeTargetOrder("tgt-guest", null, "_previous_proof", guestProof.version.id);
    expect((await applyReusedProofsForOrder({ shopId, orderId: c.order.id })).created).toBe(0);

    // the proof is on the very same order
    const same = await makeOrder("same", customerA);
    const sameProof = await makeApprovedProof(same.id);
    await db.shopifyOrderLine.create({
      data: {
        orderId: same.id,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Polo",
        quantity: 1,
        properties: { create: [{ name: "_previous_proof", value: sameProof.version.id }] },
      },
    });
    expect((await applyReusedProofsForOrder({ shopId, orderId: same.id })).created).toBe(0);
  });

  it("does nothing for an order with no reuse property", async () => {
    const order = await makeOrder("plain", customerA);
    expect(await applyReusedProofsForOrder({ shopId, orderId: order.id })).toEqual({
      created: 0,
      ignored: 0,
    });
    expect(await applyReusedProofsForOrder({ shopId, orderId: randomUUID() })).toEqual({
      created: 0,
      ignored: 0,
    });
  });

  describe("undoReusedProof", () => {
    async function reuseOnce(label: string) {
      const source = await makeOrder(`src-${label}`, customerA);
      const { version } = await makeApprovedProof(source.id);
      const { order } = await makeTargetOrder(
        `tgt-${label}`,
        customerA,
        "_previous_proof",
        version.id,
      );
      await applyReusedProofsForOrder({ shopId, orderId: order.id });
      const group = await db.proofGroup.findFirstOrThrow({
        where: { orderId: order.id },
        include: { versions: true },
      });
      return { order, group, sourceVersionId: version.id };
    }

    it("cancels the copy, sends the order back to needing a proof, removes the tag, and leaves the original untouched", async () => {
      const { order, group, sourceVersionId } = await reuseOnce("undo");
      vi.mocked(syncOrderLifecycleTag).mockClear();

      const result = await undoReusedProof({
        shopId,
        proofGroupId: group.id,
        staffUserId: "staff",
      });
      expect(result).toEqual({ outcome: "undone" });

      const after = await db.proofGroup.findUniqueOrThrow({
        where: { id: group.id },
        include: { versions: true },
      });
      expect(after.status).toBe("CANCELLED");
      expect(after.versions.every((v) => v.status === "CANCELLED")).toBe(true);

      const reloaded = await db.shopifyOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { activity: true },
      });
      expect(["PARTIALLY_APPROVED", "ALL_REQUIRED_PROOFS_APPROVED"]).not.toContain(
        reloaded.proofSummary,
      );
      expect(reloaded.activity.some((e) => e.eventType === "proof_group_reuse_undone")).toBe(true);
      expect(syncOrderLifecycleTag).toHaveBeenCalledWith({
        shopId,
        orderId: order.id,
        addTag: null,
        removeTags: ["proof_accepted"],
      });

      // The customer's original approved proof is exactly as it was.
      const original = await db.proofVersion.findUniqueOrThrow({ where: { id: sourceVersionId } });
      expect(original.status).toBe("APPROVED");

      // And a later re-import must not quietly recreate what staff just undid.
      expect(await applyReusedProofsForOrder({ shopId, orderId: order.id })).toEqual({
        created: 0,
        ignored: 0,
      });
      expect(
        await db.proofGroup.count({ where: { orderId: order.id, status: { not: "CANCELLED" } } }),
      ).toBe(0);
    });

    it("is idempotent, and refuses a group that is not a reuse or has moved on to export", async () => {
      const { group } = await reuseOnce("undo2");
      await undoReusedProof({ shopId, proofGroupId: group.id, staffUserId: "staff" });
      expect(
        await undoReusedProof({ shopId, proofGroupId: group.id, staffUserId: "staff" }),
      ).toEqual({ outcome: "already_there" });

      const exported = await reuseOnce("undo3");
      await db.proofGroup.update({
        where: { id: exported.group.id },
        data: { status: "READY_FOR_EXPORT" },
      });
      const refused = await undoReusedProof({
        shopId,
        proofGroupId: exported.group.id,
        staffUserId: "staff",
      });
      expect(refused.outcome).toBe("rejected");

      const ordinaryOrder = await makeOrder("ordinary", customerA);
      const ordinary = await makeApprovedProof(ordinaryOrder.id);
      expect(
        (await undoReusedProof({ shopId, proofGroupId: ordinary.group.id, staffUserId: "staff" }))
          .outcome,
      ).toBe("rejected");

      expect(
        (await undoReusedProof({ shopId, proofGroupId: randomUUID(), staffUserId: "staff" }))
          .outcome,
      ).toBe("rejected");
    });
  });
});
