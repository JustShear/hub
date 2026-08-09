import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { ShopifyGraphQLError } from "~/adapters/shopify/client.server";

vi.mock("~/domain/orders/import-order.server", () => ({
  importShopifyOrder: vi.fn(),
  OrderNotFoundError: class OrderNotFoundError extends Error {
    constructor(gid: string) {
      super(`Shopify order ${gid} was not found`);
      this.name = "OrderNotFoundError";
    }
  },
}));

const { importShopifyOrder } = await import("~/domain/orders/import-order.server");
const { reconcileFulfillmentStatus } = await import(
  "~/domain/orders/reconcile-fulfillment-status.server"
);

async function createOrder(workflowStatus: OrderStatus) {
  const shop = await db.shop.findFirstOrThrow();
  return db.shopifyOrder.create({
    data: {
      shopId: shop.id,
      shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
      orderNumber: `#reconcile-test-${randomUUID()}`,
      shopifyCreatedAt: new Date(),
      tags: [],
      rawPayload: {},
      workflowStatus,
    },
  });
}

function mockResultFor(overrides: { wasFulfilledJustNow?: boolean } = {}) {
  return {
    orderId: randomUUID(),
    wasNewOrder: false,
    wasCancelledJustNow: false,
    wasFulfilledJustNow: false,
    wasExportedForPrintJustNow: false,
    changeDescriptions: [],
    ...overrides,
  };
}

describe("reconcileFulfillmentStatus (integration)", () => {
  const createdOrderIds: string[] = [];
  const createdFailureIds: string[] = [];

  beforeEach(() => {
    vi.mocked(importShopifyOrder).mockReset();
  });

  afterAll(async () => {
    if (createdFailureIds.length > 0) {
      await db.integrationAttempt.deleteMany({ where: { failureId: { in: createdFailureIds } } });
      await db.integrationFailure.deleteMany({ where: { id: { in: createdFailureIds } } });
    }
    if (createdOrderIds.length > 0) {
      await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
  });

  it("only re-syncs orders active on the board, never on_hold/cancelled/archived/fulfilled ones", async () => {
    const active = await createOrder(OrderStatus.NEW);
    createdOrderIds.push(active.id);
    const onHold = await createOrder(OrderStatus.ON_HOLD);
    createdOrderIds.push(onHold.id);

    vi.mocked(importShopifyOrder).mockResolvedValue(mockResultFor());

    await reconcileFulfillmentStatus({ delayBetweenOrdersMs: 0 });

    expect(importShopifyOrder).toHaveBeenCalledWith(active.shopId, active.shopifyOrderGid);
    expect(importShopifyOrder).not.toHaveBeenCalledWith(onHold.shopId, onHold.shopifyOrderGid);
  });

  it("counts moved-to-fulfilled and unchanged orders separately", async () => {
    const fulfilled = await createOrder(OrderStatus.READY_TO_PACK);
    createdOrderIds.push(fulfilled.id);
    const stillActive = await createOrder(OrderStatus.NEW);
    createdOrderIds.push(stillActive.id);

    vi.mocked(importShopifyOrder).mockImplementation((_shopId, gid) =>
      Promise.resolve(
        mockResultFor({ wasFulfilledJustNow: gid === fulfilled.shopifyOrderGid }),
      ),
    );

    const result = await reconcileFulfillmentStatus({ delayBetweenOrdersMs: 0 });

    expect(result.movedToFulfilled).toBeGreaterThanOrEqual(1);
    expect(result.unchanged).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
  });

  it("records an IntegrationFailure for a failed order but keeps sweeping the rest", async () => {
    const failing = await createOrder(OrderStatus.NEW);
    createdOrderIds.push(failing.id);
    const succeeding = await createOrder(OrderStatus.NEW);
    createdOrderIds.push(succeeding.id);

    vi.mocked(importShopifyOrder).mockImplementation((_shopId, gid) => {
      if (gid === failing.shopifyOrderGid) {
        return Promise.reject(
          new ShopifyGraphQLError("Shopify GraphQL request failed with status 500", {
            status: 500,
          }),
        );
      }
      return Promise.resolve(mockResultFor());
    });

    const result = await reconcileFulfillmentStatus({ delayBetweenOrdersMs: 0 });

    expect(result.failed).toBe(1);
    expect(importShopifyOrder).toHaveBeenCalledWith(
      succeeding.shopId,
      succeeding.shopifyOrderGid,
    );

    const failure = await db.integrationFailure.findFirst({
      where: { action: `order-import:${failing.shopifyOrderGid}` },
    });
    expect(failure).not.toBeNull();
    if (failure) createdFailureIds.push(failure.id);
  });
});
