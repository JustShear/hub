import { randomUUID } from "node:crypto";
import { db } from "~/lib/db.server";

/** Shared fixture helpers for Milestone 14 (exception cases) integration tests. */
export function createExceptionTestTracker() {
  const orderIds: string[] = [];
  const staffUserIds: string[] = [];
  const exceptionCaseIds: string[] = [];

  async function cleanup() {
    if (exceptionCaseIds.length > 0) {
      await db.exceptionCaseResolution.deleteMany({
        where: { exceptionCaseId: { in: exceptionCaseIds } },
      });
      await db.exceptionCaseNote.deleteMany({
        where: { exceptionCaseId: { in: exceptionCaseIds } },
      });
      await db.exceptionCaseAttachment.deleteMany({
        where: { exceptionCaseId: { in: exceptionCaseIds } },
      });
      await db.exceptionCase.deleteMany({ where: { id: { in: exceptionCaseIds } } });
    }
    if (orderIds.length > 0) {
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
        orderNumber: `#exception-test-${randomUUID()}`,
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

  function trackExceptionCase(exceptionCaseId: string) {
    exceptionCaseIds.push(exceptionCaseId);
  }

  return {
    cleanup,
    createOrder,
    createOrderLine,
    createStaffUser,
    trackExceptionCase,
  };
}
