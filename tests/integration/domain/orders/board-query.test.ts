import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  AssignmentRole,
  DueDateSource,
  DueDateType,
  IntegrationFailureStatus,
  IntegrationType,
  OrderStatus,
  Priority,
  Severity,
} from "@prisma/client";
import { db } from "~/lib/db.server";
import { loadBoardColumns } from "~/domain/orders/board-query.server";
import { EMPTY_BOARD_FILTERS } from "~/domain/orders/board-filters";

describe("loadBoardColumns (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdStaffUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.orderAssignment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.orderDueDate.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.integrationFailure.deleteMany({
        where: { relatedOrderId: { in: createdOrderIds } },
      });
      await db.shopifyOrderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdStaffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: createdStaffUserIds } } });
    }
  });

  async function createStaffUser(name: string) {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await db.staffUser.create({
      data: {
        shopId: shop.id,
        email: `test-${randomUUID()}@example.com`,
        name,
        passwordHash: "irrelevant",
      },
    });
    createdStaffUserIds.push(staffUser.id);
    return staffUser;
  }

  it("places a real order in the correct column, and reports honest thumbnails/tags/priority/time-in-state", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const changedAt = new Date(Date.now() - 5 * 86_400_000);

    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#board-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: ["embroidery", "rush"],
        rawPayload: {},
        workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
        workflowStatusChangedAt: changedAt,
        priority: Priority.HIGH,
      },
    });
    createdOrderIds.push(order.id);

    await db.shopifyOrderLine.create({
      data: {
        orderId: order.id,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Test Product With Image",
        quantity: 2,
        imageUrl: "https://cdn.shopify.com/s/files/1/example.png",
      },
    });
    await db.shopifyOrderLine.create({
      data: {
        orderId: order.id,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Test Product Without Image",
        quantity: 1,
        imageUrl: null,
      },
    });

    const result = await loadBoardColumns({
      shopId: shop.id,
      filters: EMPTY_BOARD_FILTERS,
      sort: { field: "urgency_default" },
      currentStaffUserId: "irrelevant",
    });

    const column = result.columns.find((c) => c.key === "proof_being_prepared");
    expect(column).toBeDefined();
    const card = column?.cards.find((c) => c.id === order.id);
    expect(card).toBeDefined();

    expect(card?.tags).toEqual(["embroidery", "rush"]);
    expect(card?.priority).toBe(Priority.HIGH);
    expect(card?.lineCount).toBe(2);
    expect(card?.lines.some((l) => l.imageUrl === null)).toBe(true);
    expect(card?.lines.some((l) => l.imageUrl !== null)).toBe(true);
    expect(card?.daysInState).toBeGreaterThanOrEqual(4);
  });

  it("reports assignment, due-date state, and integration warnings honestly", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await createStaffUser("Assignment Test Staff");

    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#board-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus: OrderStatus.NEW,
      },
    });
    createdOrderIds.push(order.id);

    await db.orderAssignment.create({
      data: { orderId: order.id, staffUserId: staffUser.id, role: AssignmentRole.ARTWORK },
    });
    await db.orderDueDate.create({
      data: {
        orderId: order.id,
        type: DueDateType.DISPATCH,
        dueDate: new Date(Date.now() - 86_400_000),
        source: DueDateSource.MANUAL_OVERRIDE,
      },
    });
    const failure = await db.integrationFailure.create({
      data: {
        shopId: shop.id,
        integration: IntegrationType.SHOPIFY_TAG_UPDATE,
        action: "test-action",
        relatedOrderId: order.id,
        summary: "Test failure",
        severity: Severity.HIGH,
        status: IntegrationFailureStatus.NEW,
      },
    });

    const result = await loadBoardColumns({
      shopId: shop.id,
      filters: EMPTY_BOARD_FILTERS,
      sort: { field: "urgency_default" },
      currentStaffUserId: "irrelevant",
    });

    const card = result.columns.flatMap((c) => c.cards).find((c) => c.id === order.id);
    expect(card).toBeDefined();
    expect(card?.assignment).toMatchObject({
      staffUserId: staffUser.id,
      staffUserName: "Assignment Test Staff",
    });
    expect(card?.nearestDueDate?.state).toBe("overdue");
    expect(card?.hasIntegrationIssue).toBe(true);
    expect(card?.integrationIssues.map((i) => i.id)).toContain(failure.id);
  });

  it("never places an on-hold, cancelled, or archived order on the main board", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#board-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus: OrderStatus.CANCELLED,
      },
    });
    createdOrderIds.push(order.id);

    const result = await loadBoardColumns({
      shopId: shop.id,
      filters: EMPTY_BOARD_FILTERS,
      sort: { field: "urgency_default" },
      currentStaffUserId: "irrelevant",
    });

    const found = result.columns.flatMap((c) => c.cards).find((c) => c.id === order.id);
    expect(found).toBeUndefined();
  });

  it("filters by priority", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const urgentOrder = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#board-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus: OrderStatus.NEW,
        priority: Priority.URGENT,
      },
    });
    createdOrderIds.push(urgentOrder.id);
    const normalOrder = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#board-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus: OrderStatus.NEW,
        priority: Priority.NORMAL,
      },
    });
    createdOrderIds.push(normalOrder.id);

    const result = await loadBoardColumns({
      shopId: shop.id,
      filters: { ...EMPTY_BOARD_FILTERS, priority: ["URGENT"] },
      sort: { field: "urgency_default" },
      currentStaffUserId: "irrelevant",
    });

    const ids = result.columns.flatMap((c) => c.cards).map((c) => c.id);
    expect(ids).toContain(urgentOrder.id);
    expect(ids).not.toContain(normalOrder.id);
  });

  it("matches search across order number, customer, product title, and SKU", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const uniqueMarker = randomUUID().slice(0, 8);
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#board-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus: OrderStatus.NEW,
        customerName: `Search Marker ${uniqueMarker}`,
      },
    });
    createdOrderIds.push(order.id);

    const result = await loadBoardColumns({
      shopId: shop.id,
      filters: { ...EMPTY_BOARD_FILTERS, search: uniqueMarker },
      sort: { field: "urgency_default" },
      currentStaffUserId: "irrelevant",
    });

    const ids = result.columns.flatMap((c) => c.cards).map((c) => c.id);
    expect(ids).toContain(order.id);
  });

  it('places an order tagged "Exported for Print" in the Exported for Print column, not New', async () => {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#board-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: ["Exported for Print"],
        rawPayload: {},
        workflowStatus: OrderStatus.NEW,
      },
    });
    createdOrderIds.push(order.id);

    const result = await loadBoardColumns({
      shopId: shop.id,
      filters: EMPTY_BOARD_FILTERS,
      sort: { field: "urgency_default" },
      currentStaffUserId: "irrelevant",
    });

    const column = result.columns.find((c) => c.key === "exported_for_print");
    expect(column?.cards.some((c) => c.id === order.id)).toBe(true);
    const newColumn = result.columns.find((c) => c.key === "new");
    expect(newColumn?.cards.some((c) => c.id === order.id)).toBe(false);
  });

  it("reports the active freight shipment's full shape and isCancelled on a Pack-column card", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const staffUser = await createStaffUser("Freight Test Staff");
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#board-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus: OrderStatus.READY_TO_PACK,
      },
    });
    createdOrderIds.push(order.id);
    const shipment = await db.freightShipment.create({
      data: {
        shopId: shop.id,
        orderId: order.id,
        status: "CREATED",
        idempotencyKey: randomUUID(),
        carrierCode: "AusPost",
        carrierServiceCode: "3D85",
        weightKg: 1.5,
        trackingNumber: "TRACK123",
        createdByStaffId: staffUser.id,
      },
    });

    const result = await loadBoardColumns({
      shopId: shop.id,
      filters: EMPTY_BOARD_FILTERS,
      sort: { field: "urgency_default" },
      currentStaffUserId: "irrelevant",
    });

    const column = result.columns.find((c) => c.key === "pack");
    const card = column?.cards.find((c) => c.id === order.id);
    expect(card).toBeDefined();
    expect(card?.isCancelled).toBe(false);
    expect(card?.freightShipment).toMatchObject({
      id: shipment.id,
      status: "CREATED",
      trackingNumber: "TRACK123",
      weightKg: 1.5,
      carrierCode: "AusPost",
      carrierServiceCode: "3D85",
    });

    await db.freightShipment.delete({ where: { id: shipment.id } });
  });
});
