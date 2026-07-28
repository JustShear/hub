import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import {
  linkProofGroupLine,
  unlinkProofGroupLine,
} from "~/domain/proofs/link-proof-group-line.server";
import {
  linkProofGroupAsset,
  unlinkProofGroupAsset,
} from "~/domain/proofs/link-proof-group-asset.server";
import { createProofTestTracker } from "./helpers";

describe("linkProofGroupLine / linkProofGroupAsset (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  async function createGroup(staffUserId: string, orderId: string, shopId: string) {
    const result = await createProofGroup({
      shopId,
      orderId,
      name: "Test group",
      decorationMethod: "EMBROIDERY",
      placement: "Left chest",
      description: null,
      requirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId,
    });
    if (result.outcome !== "created") throw new Error("failed to create test group");
    return result.proofGroupId;
  }

  it("links one order line to several proof groups", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const groupA = await createGroup(staffUser.id, order.id, order.shopId);
    const groupB = await createGroup(staffUser.id, order.id, order.shopId);

    const resultA = await linkProofGroupLine({
      shopId: order.shopId,
      proofGroupId: groupA,
      orderLineId: line.id,
      staffUserId: staffUser.id,
    });
    const resultB = await linkProofGroupLine({
      shopId: order.shopId,
      proofGroupId: groupB,
      orderLineId: line.id,
      staffUserId: staffUser.id,
    });

    expect(resultA).toMatchObject({ outcome: "linked" });
    expect(resultB).toMatchObject({ outcome: "linked" });
    expect(await db.proofGroupOrderLine.count({ where: { orderLineId: line.id } })).toBe(2);
  });

  it("links several order lines to one proof group", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const lineA = await tracker.createOrderLine(order.id);
    const lineB = await tracker.createOrderLine(order.id);
    const group = await createGroup(staffUser.id, order.id, order.shopId);

    await linkProofGroupLine({
      shopId: order.shopId,
      proofGroupId: group,
      orderLineId: lineA.id,
      staffUserId: staffUser.id,
    });
    await linkProofGroupLine({
      shopId: order.shopId,
      proofGroupId: group,
      orderLineId: lineB.id,
      staffUserId: staffUser.id,
    });

    expect(await db.proofGroupOrderLine.count({ where: { proofGroupId: group } })).toBe(2);
  });

  it("rejects linking an order line that belongs to a different order", async () => {
    const order = await tracker.createOrder();
    const otherOrder = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const foreignLine = await tracker.createOrderLine(otherOrder.id);
    const group = await createGroup(staffUser.id, order.id, order.shopId);

    const result = await linkProofGroupLine({
      shopId: order.shopId,
      proofGroupId: group,
      orderLineId: foreignLine.id,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("treats linking the same line twice as an idempotent no-op", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const group = await createGroup(staffUser.id, order.id, order.shopId);

    const first = await linkProofGroupLine({
      shopId: order.shopId,
      proofGroupId: group,
      orderLineId: line.id,
      staffUserId: staffUser.id,
    });
    const second = await linkProofGroupLine({
      shopId: order.shopId,
      proofGroupId: group,
      orderLineId: line.id,
      staffUserId: staffUser.id,
    });

    expect(first).toMatchObject({ outcome: "linked" });
    expect(second).toMatchObject({ outcome: "already_there" });
    expect(await db.proofGroupOrderLine.count({ where: { proofGroupId: group } })).toBe(1);
  });

  it("unlinks a line without deleting the proof group", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const group = await createGroup(staffUser.id, order.id, order.shopId);
    await linkProofGroupLine({
      shopId: order.shopId,
      proofGroupId: group,
      orderLineId: line.id,
      staffUserId: staffUser.id,
    });

    const result = await unlinkProofGroupLine({
      shopId: order.shopId,
      proofGroupId: group,
      orderLineId: line.id,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "unlinked" });
    expect(await db.proofGroupOrderLine.count({ where: { proofGroupId: group } })).toBe(0);
    expect(await db.proofGroup.count({ where: { id: group } })).toBe(1);
  });

  it("links a customer artwork asset, preserving its original order-line association", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const asset = await tracker.createAsset(order.shopId);
    await db.artworkOrderLineLink.create({ data: { assetId: asset.id, orderLineId: line.id } });
    const group = await createGroup(staffUser.id, order.id, order.shopId);

    const result = await linkProofGroupAsset({
      shopId: order.shopId,
      proofGroupId: group,
      assetId: asset.id,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "linked" });
    // Original order-line association is untouched.
    expect(
      await db.artworkOrderLineLink.count({ where: { assetId: asset.id, orderLineId: line.id } }),
    ).toBe(1);
  });

  it("rejects linking an asset that belongs to a different shop", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const group = await createGroup(staffUser.id, order.id, order.shopId);
    const otherShop = await db.shop.create({
      data: {
        shopifyDomain: `other-shop-${Date.now()}.myshopify.com`,
        shopifyShopGid: `gid://shopify/Shop/${Date.now()}`,
        adminApiToken: "irrelevant",
        scopes: "read_orders",
      },
    });
    const foreignAsset = await tracker.createAsset(otherShop.id);

    const result = await linkProofGroupAsset({
      shopId: order.shopId,
      proofGroupId: group,
      assetId: foreignAsset.id,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    await db.customerArtworkAsset.deleteMany({ where: { shopId: otherShop.id } });
    await db.shop.delete({ where: { id: otherShop.id } });
  });

  it("a customer upload may be linked to more than one proof group", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const asset = await tracker.createAsset(order.shopId);
    const groupA = await createGroup(staffUser.id, order.id, order.shopId);
    const groupB = await createGroup(staffUser.id, order.id, order.shopId);

    await linkProofGroupAsset({
      shopId: order.shopId,
      proofGroupId: groupA,
      assetId: asset.id,
      staffUserId: staffUser.id,
    });
    await linkProofGroupAsset({
      shopId: order.shopId,
      proofGroupId: groupB,
      assetId: asset.id,
      staffUserId: staffUser.id,
    });

    expect(await db.proofGroupArtworkAsset.count({ where: { assetId: asset.id } })).toBe(2);
  });

  it("unlinks an asset without deleting the underlying CustomerArtworkAsset", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const asset = await tracker.createAsset(order.shopId);
    const group = await createGroup(staffUser.id, order.id, order.shopId);
    await linkProofGroupAsset({
      shopId: order.shopId,
      proofGroupId: group,
      assetId: asset.id,
      staffUserId: staffUser.id,
    });

    const result = await unlinkProofGroupAsset({
      shopId: order.shopId,
      proofGroupId: group,
      assetId: asset.id,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "unlinked" });
    expect(await db.customerArtworkAsset.count({ where: { id: asset.id } })).toBe(1);
  });
});
