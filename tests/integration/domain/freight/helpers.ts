import { randomUUID } from "node:crypto";
import type { OrderProductionSummary } from "@prisma/client";
import { db } from "~/lib/db.server";

const VALID_SHIPPING_ADDRESS = {
  name: "Test Customer",
  address1: "123 Test Street",
  address2: null,
  city: "Adelaide",
  provinceCode: "SA",
  zip: "5000",
  countryCodeV2: "AU",
  phone: "0400000000",
};

/** Shared fixture helpers for Milestone 12 (Starshipit freight) integration tests. */
export function createFreightTestTracker() {
  const orderIds: string[] = [];
  const staffUserIds: string[] = [];

  async function cleanup() {
    if (orderIds.length > 0) {
      const shipmentIds = (
        await db.freightShipment.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((s) => s.id);
      if (shipmentIds.length > 0) {
        await db.freightShipment.deleteMany({ where: { id: { in: shipmentIds } } });
      }
      const failureIds = (
        await db.integrationFailure.findMany({
          where: { relatedOrderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((f) => f.id);
      if (failureIds.length > 0) {
        await db.integrationAttempt.deleteMany({ where: { failureId: { in: failureIds } } });
        await db.integrationFailure.deleteMany({ where: { id: { in: failureIds } } });
      }
      await db.activityEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      const lineIds = (
        await db.shopifyOrderLine.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true },
        })
      ).map((l) => l.id);
      if (lineIds.length > 0) {
        await db.shopifyOrderLine.deleteMany({ where: { id: { in: lineIds } } });
      }
      await db.shopifyOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (staffUserIds.length > 0) {
      await db.staffUser.deleteMany({ where: { id: { in: staffUserIds } } });
    }
  }

  async function createOrder(
    overrides: {
      productionSummary?: OrderProductionSummary;
      shippingAddress?: unknown;
      cancelledAt?: Date | null;
    } = {},
  ) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#freight-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        customerEmail: `customer-${randomUUID()}@example.test`,
        customerName: "Test Customer",
        productionSummary: overrides.productionSummary ?? "COMPLETE",
        shippingAddress:
          overrides.shippingAddress === undefined
            ? VALID_SHIPPING_ADDRESS
            : (overrides.shippingAddress as never),
        cancelledAt: overrides.cancelledAt ?? undefined,
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function createOrderLine(orderId: string, quantity = 5) {
    return db.shopifyOrderLine.create({
      data: {
        orderId,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle: "Test Product",
        sku: "TEST-SKU",
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

  return { cleanup, createOrder, createOrderLine, createStaffUser };
}

export { VALID_SHIPPING_ADDRESS };
