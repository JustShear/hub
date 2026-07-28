import { afterAll, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createProofGroup } from "~/domain/proofs/create-proof-group.server";
import { createProofTestTracker } from "./helpers";

describe("createProofGroup (integration)", () => {
  const tracker = createProofTestTracker();
  afterAll(tracker.cleanup);

  it("creates a proof group defaulting to UNDETERMINED requirement when none is chosen", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const result = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Sleeve logo",
      decorationMethod: "EMBROIDERY",
      placement: "Right sleeve",
      description: null,
      requirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: result.proofGroupId } });
    expect(group.status).toBe("NOT_STARTED");
    const requirement = await db.proofRequirement.findUnique({
      where: { proofGroupId: result.proofGroupId },
    });
    expect(requirement?.value).toBe("UNDETERMINED");
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("never infers NO_PROOF_REQUIRED or REQUIRED — only what the caller explicitly requests", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const line = await tracker.createOrderLine(order.id);
    const asset = await tracker.createAsset(order.shopId);

    // Even with lines AND an asset linked, requirement stays UNDETERMINED
    // unless the caller explicitly chose otherwise.
    const result = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Full back print",
      decorationMethod: "SCREEN_PRINT",
      placement: "Full back",
      description: null,
      requirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [line.id],
      assetIds: [asset.id],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    const requirement = await db.proofRequirement.findUnique({
      where: { proofGroupId: result.proofGroupId },
    });
    expect(requirement?.value).toBe("UNDETERMINED");
  });

  it("rejects NO_PROOF_REQUIRED without a reason", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const result = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Unprinted garments",
      decorationMethod: "UNPRINTED",
      placement: null,
      description: null,
      requirement: "NOT_REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("requires explanatory text when the no-proof reason is OTHER", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const result = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Odd case",
      decorationMethod: "OTHER",
      placement: null,
      description: null,
      requirement: "NOT_REQUIRED",
      noProofReason: "OTHER",
      noProofReasonNote: null,
      orderLineIds: [],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("creates a no-proof-required group and records a ManualOverride", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();

    const result = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Repeat approved logo",
      decorationMethod: "EMBROIDERY",
      placement: "Left sleeve",
      description: null,
      requirement: "NOT_REQUIRED",
      noProofReason: "REPEAT_JOB_PREVIOUS_ARTWORK",
      noProofReasonNote: null,
      orderLineIds: [],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    const group = await db.proofGroup.findUniqueOrThrow({ where: { id: result.proofGroupId } });
    expect(group.status).toBe("NO_PROOF_REQUIRED");
    expect(group.requiresApproval).toBe(false);
    const override = await db.manualOverride.findFirstOrThrow({
      where: { relatedEntityId: result.proofGroupId },
    });
    expect(override.overrideType).toBe("MARK_NO_PROOF_REQUIRED");
  });

  it("links several order lines to one proof group", async () => {
    const order = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const lineA = await tracker.createOrderLine(order.id, 5);
    const lineB = await tracker.createOrderLine(order.id, 3);
    const lineC = await tracker.createOrderLine(order.id, 2);

    const result = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Left chest embroidery",
      decorationMethod: "EMBROIDERY",
      placement: "Left chest",
      description: null,
      requirement: "REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [lineA.id, lineB.id, lineC.id],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    const links = await db.proofGroupOrderLine.findMany({
      where: { proofGroupId: result.proofGroupId },
    });
    expect(links).toHaveLength(3);
  });

  it("rejects linking an order line that belongs to a different order", async () => {
    const order = await tracker.createOrder();
    const otherOrder = await tracker.createOrder();
    const staffUser = await tracker.createStaffUser();
    const foreignLine = await tracker.createOrderLine(otherOrder.id);

    const result = await createProofGroup({
      shopId: order.shopId,
      orderId: order.id,
      name: "Cross-order test",
      decorationMethod: "EMBROIDERY",
      placement: "Left chest",
      description: null,
      requirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [foreignLine.id],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
  });

  it("returns rejected for a non-existent order", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const result = await createProofGroup({
      shopId: shop.id,
      orderId: "does-not-exist",
      name: "Test",
      decorationMethod: "EMBROIDERY",
      placement: null,
      description: null,
      requirement: "UNDETERMINED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [],
      assetIds: [],
      assignedStaffId: null,
      dueDate: null,
      priority: null,
      staffUserId: "does-not-exist",
    });
    expect(result.outcome).toBe("rejected");
  });
});
