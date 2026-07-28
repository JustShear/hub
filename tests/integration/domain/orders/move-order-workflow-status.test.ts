import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { moveOrderWorkflowStatus } from "~/domain/orders/move-order-workflow-status.server";

describe("moveOrderWorkflowStatus (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  async function createOrder(workflowStatus: OrderStatus) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus,
      },
    });
    createdOrderIds.push(order.id);
    return order;
  }

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

  it("moves an order to a valid target column and records exactly one ActivityEvent", async () => {
    const order = await createOrder(OrderStatus.NEW);
    const staffUser = await createStaffUser();

    const result = await moveOrderWorkflowStatus({
      shopId: order.shopId,
      orderId: order.id,
      targetColumnKey: "proof_being_prepared",
      expectedWorkflowStatus: OrderStatus.NEW,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({
      outcome: "moved",
      workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
    });

    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.workflowStatus).toBe(OrderStatus.PROOFING_IN_PROGRESS);

    const events = await db.activityEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "workflow_status_changed",
      actorStaffId: staffUser.id,
    });
    expect(events[0]?.metadata).toMatchObject({
      previousStatus: OrderStatus.NEW,
      newStatus: OrderStatus.PROOFING_IN_PROGRESS,
      source: "kanban_board",
    });
  });

  it("rejects a move to a non-interactive column (exported_for_print)", async () => {
    const order = await createOrder(OrderStatus.NEW);
    const staffUser = await createStaffUser();

    const result = await moveOrderWorkflowStatus({
      shopId: order.shopId,
      orderId: order.id,
      targetColumnKey: "exported_for_print",
      expectedWorkflowStatus: OrderStatus.NEW,
      staffUserId: staffUser.id,
    });

    expect(result.outcome).toBe("rejected");
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.workflowStatus).toBe(OrderStatus.NEW);
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("rejects moving a cancelled order", async () => {
    const order = await createOrder(OrderStatus.CANCELLED);
    const staffUser = await createStaffUser();

    const result = await moveOrderWorkflowStatus({
      shopId: order.shopId,
      orderId: order.id,
      targetColumnKey: "new",
      expectedWorkflowStatus: OrderStatus.CANCELLED,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({ outcome: "rejected" });
    if (result.outcome === "rejected") {
      expect(result.reason).toMatch(/cancelled|archived/i);
    }
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.workflowStatus).toBe(OrderStatus.CANCELLED);
  });

  it("reports a conflict and does not overwrite when the order changed since the client last saw it", async () => {
    const order = await createOrder(OrderStatus.WAITING_CUSTOMER);
    const staffUser = await createStaffUser();

    // Client still thinks the order is NEW, but it's actually WAITING_CUSTOMER.
    const result = await moveOrderWorkflowStatus({
      shopId: order.shopId,
      orderId: order.id,
      targetColumnKey: "proof_being_prepared",
      expectedWorkflowStatus: OrderStatus.NEW,
      staffUserId: staffUser.id,
    });

    expect(result).toMatchObject({
      outcome: "conflict",
      actualWorkflowStatus: OrderStatus.WAITING_CUSTOMER,
    });
    const updated = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.workflowStatus).toBe(OrderStatus.WAITING_CUSTOMER);
    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("treats an exact duplicate submission as an idempotent no-op with no duplicate ActivityEvent", async () => {
    const order = await createOrder(OrderStatus.NEW);
    const staffUser = await createStaffUser();

    const input = {
      shopId: order.shopId,
      orderId: order.id,
      targetColumnKey: "proof_being_prepared" as const,
      expectedWorkflowStatus: OrderStatus.NEW,
      staffUserId: staffUser.id,
    };

    const first = await moveOrderWorkflowStatus(input);
    expect(first.outcome).toBe("moved");

    // Simulates a client retry that resubmits the exact same (now-stale)
    // expectedWorkflowStatus after the first request actually succeeded.
    const second = await moveOrderWorkflowStatus(input);
    expect(second).toMatchObject({
      outcome: "already_there",
      workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
    });

    expect(await db.activityEvent.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("returns rejected for a non-existent order", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const result = await moveOrderWorkflowStatus({
      shopId: shop.id,
      orderId: "does-not-exist",
      targetColumnKey: "new",
      expectedWorkflowStatus: OrderStatus.NEW,
      staffUserId: "does-not-exist",
    });
    expect(result.outcome).toBe("rejected");
  });
});
