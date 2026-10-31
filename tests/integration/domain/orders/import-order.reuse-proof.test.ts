import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import type { RawShopifyOrder } from "~/adapters/shopify/orders.server";

vi.mock("~/adapters/shopify/orders.server", () => ({ fetchShopifyOrder: vi.fn() }));
vi.mock("~/domain/orders/sync-order-lifecycle-tag.server", () => ({
  syncOrderLifecycleTag: vi.fn(() => Promise.resolve({ outcome: "synced" })),
}));

const { fetchShopifyOrder } = await import("~/adapters/shopify/orders.server");
const { importShopifyOrder } = await import("~/domain/orders/import-order.server");

// End to end through the real import: the options app writes the hidden
// "_previous_proof" line property at checkout, Shopify hands it back as a line
// item custom attribute, and the import must turn it into an approved group.
describe("importShopifyOrder applies a reused proof (integration)", () => {
  const customerGid = `gid://shopify/Customer/4${Date.now()}`;
  const orderIds: string[] = [];

  beforeEach(() => {
    vi.mocked(fetchShopifyOrder).mockReset();
  });

  afterAll(async () => {
    const groups = await db.proofGroup.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const groupIds = groups.map((g) => g.id);
    const versionIds = (
      await db.proofVersion.findMany({
        where: { proofGroupId: { in: groupIds } },
        select: { id: true },
      })
    ).map((v) => v.id);
    const lineIds = (
      await db.shopifyOrderLine.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      })
    ).map((l) => l.id);
    await db.proofAsset.deleteMany({ where: { proofVersionId: { in: versionIds } } });
    await db.proofVersion.deleteMany({ where: { id: { in: versionIds } } });
    await db.proofGroupOrderLine.deleteMany({ where: { proofGroupId: { in: groupIds } } });
    await db.proofRequirement.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.proofGroup.deleteMany({ where: { id: { in: groupIds } } });
    await db.activityEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.shopifyLineProperty.deleteMany({ where: { orderLineId: { in: lineIds } } });
    await db.shopifyOrderLine.deleteMany({ where: { id: { in: lineIds } } });
    await db.shopifyOrder.deleteMany({ where: { id: { in: orderIds } } });
  });

  function rawOrder(
    id: string,
    name: string,
    customAttributes: { key: string; value: string }[],
  ): RawShopifyOrder {
    return {
      id,
      legacyResourceId: "1000000099",
      name,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
      cancelledAt: null,
      cancelReason: null,
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "UNFULFILLED",
      tags: [],
      note: null,
      customer: {
        id: customerGid,
        email: "reorder@example.com",
        phone: null,
        displayName: "Reorder Customer",
      },
      shippingAddress: null,
      billingAddress: null,
      shippingLine: null,
      currencyCode: "AUD",
      subtotalPriceSet: { shopMoney: { amount: "100.00" } },
      totalPriceSet: { shopMoney: { amount: "100.00" } },
      totalDiscountsSet: { shopMoney: { amount: "0.00" } },
      totalTaxSet: { shopMoney: { amount: "0.00" } },
      discountCodes: [],
      lineItems: [
        {
          id: `gid://shopify/LineItem/${name}`,
          title: "Polo",
          variantTitle: null,
          sku: "POLO",
          quantity: 3,
          fulfillableQuantity: 3,
          customAttributes,
          product: null,
          variant: null,
        },
      ],
      fulfillments: [],
    };
  }

  async function seedApprovedSourceProof() {
    const shop = await db.shop.findFirstOrThrow();
    const sourceOrder = await db.shopifyOrder.create({
      data: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/${randomUUID()}`,
        orderNumber: `#SRC-${randomUUID().slice(0, 6)}`,
        shopifyCreatedAt: new Date(),
        rawPayload: {},
        customerShopifyGid: customerGid,
      },
    });
    orderIds.push(sourceOrder.id);
    const group = await db.proofGroup.create({
      data: {
        orderId: sourceOrder.id,
        name: "Back print",
        decorationMethod: "DIGITAL_PRINT_DTF",
        status: "APPROVED",
      },
    });
    const version = await db.proofVersion.create({
      data: {
        proofGroupId: group.id,
        versionNumber: 2,
        status: "APPROVED",
        createdByStaffId: "staff",
        approvedAt: new Date(),
      },
    });
    await db.proofAsset.create({
      data: {
        proofVersionId: version.id,
        storageKey: `proof-versions/${randomUUID()}.png`,
        isPrimary: true,
        mimeType: "image/png",
      },
    });
    return { shop, version };
  }

  it("creates the approved reorder group when a new order arrives carrying the property", async () => {
    const { shop, version } = await seedApprovedSourceProof();
    const gid = `gid://shopify/Order/${randomUUID()}`;
    vi.mocked(fetchShopifyOrder).mockResolvedValue(
      rawOrder(gid, "#RO-1", [{ key: "_previous_proof: Logo", value: version.id }]),
    );

    const result = await importShopifyOrder(shop.id, gid);
    orderIds.push(result.orderId);

    const groups = await db.proofGroup.findMany({
      where: { orderId: result.orderId },
      include: { versions: true, orderLines: true },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ status: "APPROVED", name: "Reorder: Back print" });
    expect(groups[0]?.versions[0]?.reusedFromVersionId).toBe(version.id);
    expect(groups[0]?.orderLines[0]?.quantity).toBe(3);

    // A webhook re-sync of the same order must not add a second group.
    await importShopifyOrder(shop.id, gid);
    expect(await db.proofGroup.count({ where: { orderId: result.orderId } })).toBe(1);
  });

  it("imports normally, creating no group, when the picked proof isn't the customer's", async () => {
    const shop = await db.shop.findFirstOrThrow();
    const gid = `gid://shopify/Order/${randomUUID()}`;
    vi.mocked(fetchShopifyOrder).mockResolvedValue(
      rawOrder(gid, "#RO-2", [{ key: "_previous_proof", value: "cl-forged-id" }]),
    );

    const result = await importShopifyOrder(shop.id, gid);
    orderIds.push(result.orderId);

    expect(result.wasNewOrder).toBe(true);
    expect(await db.proofGroup.count({ where: { orderId: result.orderId } })).toBe(0);
  });
});
