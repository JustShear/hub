import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProductionArtwork } from "~/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "~/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "~/domain/production/mark-production-artwork-ready.server";
import { cancelProductionArtwork } from "~/domain/production/cancel-production-artwork.server";
import { createProductionTestTracker, PDF_BYTES } from "./helpers";

async function seedArtwork(
  tracker: ReturnType<typeof createProductionTestTracker>,
  opts: { allocate?: boolean } = {},
) {
  const order = await tracker.createOrder();
  const staffUser = await tracker.createStaffUser();
  const line = await tracker.createOrderLine(order.id);
  const approved = await tracker.createApprovedGroup({
    orderId: order.id,
    shopId: order.shopId,
    staffUserId: staffUser.id,
    orderLineId: line.id,
  });
  const created = await createProductionArtwork({
    shopId: order.shopId,
    proofGroupId: approved.proofGroupId,
    fileBuffer: PDF_BYTES,
    originalFilename: "artwork.pdf",
    decorationMethod: null,
    placement: "Left chest",
    productionMetadata: null,
    staffUserId: staffUser.id,
    idempotencyKey: null,
  });
  if (created.outcome !== "created") throw new Error("setup failed");

  if (opts.allocate !== false) {
    const allocation = await setProductionArtworkOrderLines({
      shopId: order.shopId,
      productionArtworkId: created.productionArtworkId,
      allocations: [{ orderLineId: line.id, quantity: line.quantity }],
      staffUserId: staffUser.id,
    });
    if (allocation.outcome !== "set") throw new Error("allocation failed");
  }

  return {
    order,
    staffUser,
    line,
    proofGroupId: approved.proofGroupId,
    artworkId: created.productionArtworkId,
  };
}

describe("markProductionArtworkReady (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("promotes both the artwork and the proof group to READY_FOR_EXPORT", async () => {
    const { order, staffUser, proofGroupId, artworkId } = await seedArtwork(tracker);

    const result = await markProductionArtworkReady({
      shopId: order.shopId,
      productionArtworkId: artworkId,
      staffUserId: staffUser.id,
    });
    expect(result.outcome).toBe("ready");

    const artwork = await db.productionArtwork.findUniqueOrThrow({ where: { id: artworkId } });
    expect(artwork.status).toBe("READY_FOR_EXPORT");
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("READY_FOR_EXPORT");
  });

  it("is idempotent — marking an already-ready revision ready again reports already_there", async () => {
    const { order, staffUser, artworkId } = await seedArtwork(tracker);
    await markProductionArtworkReady({
      shopId: order.shopId,
      productionArtworkId: artworkId,
      staffUserId: staffUser.id,
    });
    const second = await markProductionArtworkReady({
      shopId: order.shopId,
      productionArtworkId: artworkId,
      staffUserId: staffUser.id,
    });
    expect(second.outcome).toBe("already_there");
  });

  it("rejects when no order line has been allocated yet", async () => {
    const { order, staffUser, artworkId } = await seedArtwork(tracker, { allocate: false });
    const result = await markProductionArtworkReady({
      shopId: order.shopId,
      productionArtworkId: artworkId,
      staffUserId: staffUser.id,
    });
    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") return;
    expect(result.issues?.join(" ")).toMatch(/order line/i);
  });
});

describe("cancelProductionArtwork (integration)", () => {
  const tracker = createProductionTestTracker();
  afterAll(tracker.cleanup);

  it("cancels a DRAFT revision with a reason", async () => {
    const { order, staffUser, artworkId } = await seedArtwork(tracker);
    const result = await cancelProductionArtwork({
      shopId: order.shopId,
      productionArtworkId: artworkId,
      reason: "Wrong logo colour uploaded by mistake.",
      staffUserId: staffUser.id,
    });
    expect(result.outcome).toBe("cancelled");
    const artwork = await db.productionArtwork.findUniqueOrThrow({ where: { id: artworkId } });
    expect(artwork.status).toBe("CANCELLED");
    expect(artwork.cancelReason).toBe("Wrong logo colour uploaded by mistake.");
  });

  it("reverts the proof group's status when cancelling its READY_FOR_EXPORT-driving revision", async () => {
    const { order, staffUser, proofGroupId, artworkId } = await seedArtwork(tracker);
    await markProductionArtworkReady({
      shopId: order.shopId,
      productionArtworkId: artworkId,
      staffUserId: staffUser.id,
    });

    const result = await cancelProductionArtwork({
      shopId: order.shopId,
      productionArtworkId: artworkId,
      reason: "Customer changed their mind on placement after all.",
      staffUserId: staffUser.id,
    });
    expect(result.outcome).toBe("cancelled");

    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: proofGroupId } });
    expect(group.status).toBe("APPROVED");
  });

  it("requires a non-empty reason", async () => {
    const { order, staffUser, artworkId } = await seedArtwork(tracker);
    const result = await cancelProductionArtwork({
      shopId: order.shopId,
      productionArtworkId: artworkId,
      reason: "   ",
      staffUserId: staffUser.id,
    });
    expect(result.outcome).toBe("rejected");
  });
});
