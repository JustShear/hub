import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  getProductFulfillmentMetrics,
  TRACKED_PRODUCT_TITLES,
} from "~/domain/orders/product-fulfillment-metrics.server";

describe("getProductFulfillmentMetrics (integration)", () => {
  const createdOrderIds: string[] = [];

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await db.shopifyOrderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
  });

  async function createOrder(workflowStatus: OrderStatus) {
    const shop = await db.shop.findFirstOrThrow();
    const order = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#product-metrics-test-${randomUUID()}`,
        shopifyCreatedAt: new Date(),
        tags: [],
        rawPayload: {},
        workflowStatus,
      },
    });
    createdOrderIds.push(order.id);
    return order;
  }

  async function createLine(
    orderId: string,
    productTitle: string,
    quantity: number,
    fulfilledQuantity: number | null,
    variantTitle: string | null = null,
  ) {
    return db.shopifyOrderLine.create({
      data: {
        orderId,
        shopifyLineGid: `gid://shopify/LineItem/${randomUUID()}`,
        productTitle,
        variantTitle,
        quantity,
        fulfilledQuantity,
      },
    });
  }

  it("lists every tracked product, defaulting to zero when nothing is on order", async () => {
    const metrics = await getProductFulfillmentMetrics(randomUUID());
    expect(metrics.map((m) => m.productTitle)).toEqual(TRACKED_PRODUCT_TITLES);
    expect(metrics.every((m) => m.unfulfilledQuantity === 0)).toBe(true);
  });

  it("sums unfulfilled quantity (quantity - fulfilledQuantity) across active orders, ignoring fulfilled/cancelled ones", async () => {
    const shop = await db.shop.findFirstOrThrow();

    const activeOrderA = await createOrder(OrderStatus.NEW);
    await createLine(activeOrderA.id, "Burning Diesel", 5, 2); // 3 unfulfilled

    const activeOrderB = await createOrder(OrderStatus.PROOFING_IN_PROGRESS);
    await createLine(activeOrderB.id, "burning diesel", 2, null); // case-insensitive, null fulfilled -> 2 unfulfilled

    const fulfilledOrder = await createOrder(OrderStatus.FULFILLED);
    await createLine(fulfilledOrder.id, "Burning Diesel", 10, 0); // excluded entirely

    const cancelledOrder = await createOrder(OrderStatus.CANCELLED);
    await createLine(cancelledOrder.id, "Burning Diesel", 10, 0); // excluded entirely

    const untrackedProductOrder = await createOrder(OrderStatus.NEW);
    await createLine(untrackedProductOrder.id, "Some Other Product", 99, 0); // never counted

    const metrics = await getProductFulfillmentMetrics(shop.id);
    const burningDiesel = metrics.find((m) => m.productTitle === "Burning Diesel");
    expect(burningDiesel?.unfulfilledQuantity).toBe(5);

    const otherTracked = metrics.filter((m) => m.productTitle !== "Burning Diesel");
    expect(otherTracked.every((m) => m.unfulfilledQuantity === 0)).toBe(true);
  });

  it("matches a tracked name that's only part of a longer product title (real Shopify titles rarely match exactly)", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const order = await createOrder(OrderStatus.NEW);
    await createLine(order.id, "Singlet — Converting Fuel into Good Times Print", 3, 1); // 2 unfulfilled

    const metrics = await getProductFulfillmentMetrics(shop.id);
    expect(
      metrics.find((m) => m.productTitle === "Converting Fuel into Good Times")
        ?.unfulfilledQuantity,
    ).toBe(2);
  });

  it("matches a tracked name carried on the variant title instead of the product title", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const order = await createOrder(OrderStatus.NEW);
    await createLine(order.id, "Mens Singlet", 4, 0, "Bank of Dad / Navy / Large");

    const metrics = await getProductFulfillmentMetrics(shop.id);
    expect(metrics.find((m) => m.productTitle === "Bank of Dad")?.unfulfilledQuantity).toBe(4);
  });

  it("matches a straight apostrophe against a curly one in real data", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const order = await createOrder(OrderStatus.NEW);
    await createLine(order.id, "Dad’s Day Tee", 2, 0);

    const metrics = await getProductFulfillmentMetrics(shop.id);
    expect(metrics.find((m) => m.productTitle === "Dad's Day")?.unfulfilledQuantity).toBe(2);
  });

  it("never lets unfulfilled quantity go negative", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const order = await createOrder(OrderStatus.NEW);
    // fulfilledQuantity greater than quantity shouldn't happen in real Shopify
    // data, but the calc must not produce a negative count if it ever does.
    await createLine(order.id, "Just Shear", 1, 5);

    const metrics = await getProductFulfillmentMetrics(shop.id);
    expect(metrics.find((m) => m.productTitle === "Just Shear")?.unfulfilledQuantity).toBe(0);
  });
});
