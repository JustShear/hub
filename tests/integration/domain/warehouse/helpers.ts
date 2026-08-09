import { randomUUID } from "node:crypto";
import { db } from "~/lib/db.server";
import { createWarehousePickJobForOrder } from "~/domain/warehouse/create-warehouse-pick-job.server";

/** Shared fixture helpers for Milestone 13 (warehouse picking) integration tests. */
export function createWarehouseTestTracker() {
  const orderIds: string[] = [];
  const staffUserIds: string[] = [];

  async function cleanup() {
    if (orderIds.length > 0) {
      const pickJobIds = (
        await db.warehousePickJob.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((j) => j.id);
      if (pickJobIds.length > 0) {
        await db.warehousePickQuantityUpdate.deleteMany({
          where: { warehousePickItem: { warehousePickJobId: { in: pickJobIds } } },
        });
        await db.warehouseIssue.deleteMany({ where: { warehousePickJobId: { in: pickJobIds } } });
        await db.warehouseNote.deleteMany({ where: { warehousePickJobId: { in: pickJobIds } } });
        await db.warehousePickItem.deleteMany({
          where: { warehousePickJobId: { in: pickJobIds } },
        });
        await db.warehousePickJob.deleteMany({ where: { id: { in: pickJobIds } } });
      }

      const lineIds = (
        await db.shopifyOrderLine.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((l) => l.id);
      if (lineIds.length > 0) {
        await db.shopifyOrderLine.deleteMany({ where: { id: { in: lineIds } } });
      }

      await db.activityEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      const orderFailureIds = (
        await db.integrationFailure.findMany({
          where: { relatedOrderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((f) => f.id);
      if (orderFailureIds.length > 0) {
        await db.integrationAttempt.deleteMany({ where: { failureId: { in: orderFailureIds } } });
      }
      await db.integrationFailure.deleteMany({ where: { relatedOrderId: { in: orderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (staffUserIds.length > 0) {
      await db.notification.deleteMany({ where: { staffUserId: { in: staffUserIds } } });
      await db.staffUser.deleteMany({ where: { id: { in: staffUserIds } } });
    }
  }

  async function createOrder(overrides: { cancelledAt?: Date } = {}) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#warehouse-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        customerEmail: `customer-${randomUUID()}@example.test`,
        customerName: "Test Customer",
        cancelledAt: overrides.cancelledAt,
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function createOrderLine(orderId: string, quantity = 10) {
    return db.shopifyOrderLine.create({
      data: {
        orderId,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Test Product",
        quantity,
      },
    });
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
    staffUserIds.push(staffUser.id);
    return staffUser;
  }

  /**
   * Calls the real, idempotent createWarehousePickJobForOrder directly —
   * the same function the actual "Exported for Print" tag-gain triggers
   * call (move-order-workflow-status.server.ts / import-order.server.ts) —
   * rather than driving any UI/tag flow, since these tests only need a
   * genuine WarehousePickJob to exist as their starting fixture. The
   * `quantity` param exists only so callers can assert against a known
   * requiredQuantity; the order line itself (created via createOrderLine)
   * is what actually determines it.
   */
  async function createPickJobForOrder(params: {
    shopId: string;
    orderId: string;
    orderLineId: string;
    quantity: number;
    staffUserId: string;
  }) {
    await db.$transaction((tx) =>
      createWarehousePickJobForOrder(tx, {
        shopId: params.shopId,
        orderId: params.orderId,
        actorStaffId: params.staffUserId,
      }),
    );
    return db.warehousePickJob.findUniqueOrThrow({ where: { orderId: params.orderId } });
  }

  return {
    cleanup,
    createOrder,
    createOrderLine,
    createStaffUser,
    createPickJobForOrder,
  };
}
