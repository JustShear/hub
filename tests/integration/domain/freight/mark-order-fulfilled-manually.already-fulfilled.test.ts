import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import { createFreightTestTracker } from "./helpers";

vi.mock("~/adapters/shopify/client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/adapters/shopify/client.server")>()),
  shopifyGraphQLRequest: vi.fn(),
}));

const { shopifyGraphQLRequest } = await import("~/adapters/shopify/client.server");
const { markOrderFulfilledManually } =
  await import("~/domain/freight/mark-order-fulfilled-manually.server");

function fulfillmentOrders(...statuses: string[]) {
  return {
    order: {
      fulfillmentOrders: { nodes: statuses.map((status, i) => ({ id: `fo-${i}`, status })) },
    },
  };
}

describe("markOrderFulfilledManually when Shopify has nothing left to fulfil", () => {
  const tracker = createFreightTestTracker();
  afterAll(tracker.cleanup);
  beforeEach(() => {
    vi.mocked(shopifyGraphQLRequest).mockReset();
  });

  it("marks the Hub order fulfilled, without a fulfillmentCreate call, when every fulfilment order is CLOSED", async () => {
    const order = await tracker.createOrder({ workflowStatus: "READY_TO_PACK" });
    const staff = await tracker.createStaffUser();
    vi.mocked(shopifyGraphQLRequest).mockResolvedValueOnce(fulfillmentOrders("CLOSED", "CLOSED"));

    const result = await markOrderFulfilledManually({
      shopId: order.shopId,
      orderId: order.id,
      staffUserId: staff.id,
    });

    expect(result).toEqual({ outcome: "fulfilled" });
    expect(shopifyGraphQLRequest).toHaveBeenCalledTimes(1); // the lookup only
    const after = await db.shopifyOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { activity: true },
    });
    expect(after.workflowStatus).toBe("FULFILLED");
    expect(after.activity[0]?.summary).toMatch(/already fulfilled in Shopify/);
  });

  it("still fails when a fulfilment order is on hold, even if another is closed", async () => {
    const order = await tracker.createOrder({ workflowStatus: "READY_TO_PACK" });
    const staff = await tracker.createStaffUser();
    vi.mocked(shopifyGraphQLRequest).mockResolvedValueOnce(fulfillmentOrders("CLOSED", "ON_HOLD"));

    const result = await markOrderFulfilledManually({
      shopId: order.shopId,
      orderId: order.id,
      staffUserId: staff.id,
    });

    expect(result.outcome).toBe("rejected");
    const after = await db.shopifyOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.workflowStatus).toBe("READY_TO_PACK");
  });

  it("still fails when Shopify can't find the order at all", async () => {
    const order = await tracker.createOrder({ workflowStatus: "READY_TO_PACK" });
    const staff = await tracker.createStaffUser();
    vi.mocked(shopifyGraphQLRequest).mockResolvedValueOnce({ order: null });

    const result = await markOrderFulfilledManually({
      shopId: order.shopId,
      orderId: order.id,
      staffUserId: staff.id,
    });

    expect(result.outcome).toBe("rejected");
  });
});
