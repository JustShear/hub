import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/lib/db.server";
import type { RawShopifyOrder } from "~/adapters/shopify/orders.server";

vi.mock("~/adapters/shopify/orders.server", () => ({
  fetchShopifyOrder: vi.fn(),
}));

const { fetchShopifyOrder } = await import("~/adapters/shopify/orders.server");
const { importShopifyOrder, OrderNotFoundError } =
  await import("~/domain/orders/import-order.server");

function buildRawOrder(overrides: Partial<RawShopifyOrder> = {}): RawShopifyOrder {
  return {
    id: `gid://shopify/Order/${randomUUID()}`,
    legacyResourceId: "1000000001",
    name: "#1001",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    cancelledAt: null,
    cancelReason: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    tags: ["preorder"],
    note: "Please deliver after 5pm",
    customer: {
      id: "gid://shopify/Customer/1",
      email: "customer@example.com",
      phone: "+61400000000",
      displayName: "Test Customer",
    },
    shippingAddress: {
      name: "Test Customer",
      address1: "1 Test Street",
      address2: null,
      city: "Adelaide",
      provinceCode: "SA",
      zip: "5000",
      countryCodeV2: "AU",
      phone: null,
    },
    billingAddress: null,
    shippingLine: { title: "Standard Shipping" },
    currencyCode: "AUD",
    subtotalPriceSet: { shopMoney: { amount: "100.00" } },
    totalPriceSet: { shopMoney: { amount: "110.00" } },
    totalDiscountsSet: { shopMoney: { amount: "0.00" } },
    totalTaxSet: { shopMoney: { amount: "10.00" } },
    discountCodes: [],
    lineItems: [
      {
        // Fixed, not random: tests that call buildRawOrder() twice to
        // simulate "the same order, fetched again later" need the line item
        // GID to stay stable across calls, exactly as it would in Shopify.
        id: "gid://shopify/LineItem/default-1",
        title: "Embroidered Cap",
        variantTitle: "One Size",
        sku: "CAP-001",
        quantity: 2,
        fulfillableQuantity: 2,
        customAttributes: [],
        product: {
          id: "gid://shopify/Product/1",
          featuredImage: { url: "https://cdn.shopify.com/product.png" },
        },
        variant: {
          id: "gid://shopify/ProductVariant/1",
          barcode: "012345",
          image: { url: "https://cdn.shopify.com/variant.png" },
        },
      },
    ],
    fulfillments: [],
    ...overrides,
  };
}

async function getShop() {
  return db.shop.findFirstOrThrow();
}

describe("importShopifyOrder (integration)", () => {
  const createdOrderIds: string[] = [];

  beforeEach(() => {
    vi.mocked(fetchShopifyOrder).mockReset();
  });

  afterAll(async () => {
    if (createdOrderIds.length === 0) return;
    await db.activityEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await db.orderNote.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await db.proofRequirement.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    const lines = await db.shopifyOrderLine.findMany({
      where: { orderId: { in: createdOrderIds } },
    });
    const lineIds = lines.map((l) => l.id);
    const links = await db.artworkOrderLineLink.findMany({
      where: { orderLineId: { in: lineIds } },
    });
    const assetIds = links.map((link) => link.assetId);
    await db.artworkOrderLineLink.deleteMany({ where: { orderLineId: { in: lineIds } } });
    await db.customerArtworkAsset.deleteMany({ where: { id: { in: assetIds } } });
    await db.shopifyLineProperty.deleteMany({ where: { orderLineId: { in: lineIds } } });
    await db.shopifyOrderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await db.shopifyOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
  });

  it("creates a new order, its lines, an UNDETERMINED proof requirement, and an import activity event", async () => {
    const shop = await getShop();
    const raw = buildRawOrder();
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const result = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(result.orderId);

    expect(result.wasNewOrder).toBe(true);

    const order = await db.shopifyOrder.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { lines: true, proofRequirements: true, activity: true },
    });

    expect(order.orderNumber).toBe("#1001");
    expect(order.workflowStatus).toBe("NEW");
    expect(order.priority).toBe("NORMAL");
    expect(order.customerEmail).toBe("customer@example.com");
    expect(order.lines).toHaveLength(1);
    expect(order.proofRequirements).toHaveLength(1);
    expect(order.proofRequirements[0]?.value).toBe("UNDETERMINED");
    expect(order.activity.some((e) => e.eventType === "ORDER_IMPORTED")).toBe(true);
  });

  it("throws OrderNotFoundError when Shopify returns no order", async () => {
    const shop = await getShop();
    vi.mocked(fetchShopifyOrder).mockResolvedValue(null);

    await expect(importShopifyOrder(shop.id, "gid://shopify/Order/missing")).rejects.toBeInstanceOf(
      OrderNotFoundError,
    );
  });

  it("does not create a duplicate order or duplicate lines when the same order is imported twice", async () => {
    const shop = await getShop();
    const raw = buildRawOrder();
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const first = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(first.orderId);
    const second = await importShopifyOrder(shop.id, raw.id);

    expect(second.orderId).toBe(first.orderId);
    expect(second.wasNewOrder).toBe(false);

    const orders = await db.shopifyOrder.findMany({
      where: { shopId: shop.id, shopifyOrderGid: raw.id },
    });
    expect(orders).toHaveLength(1);

    const lines = await db.shopifyOrderLine.findMany({ where: { orderId: first.orderId } });
    expect(lines).toHaveLength(1);
  });

  it("preserves Production Hub-owned fields when Shopify sends an update", async () => {
    const shop = await getShop();
    const raw = buildRawOrder();
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const created = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(created.orderId);

    // Simulate staff having done real workflow work on this order.
    await db.shopifyOrder.update({
      where: { id: created.orderId },
      data: { workflowStatus: "PROOFING_IN_PROGRESS", priority: "URGENT" },
    });
    await db.orderNote.create({
      data: {
        orderId: created.orderId,
        authorStaffId: "staff_1",
        body: "Called customer",
        visibility: "INTERNAL",
      },
    });

    // Shopify sends an update (e.g. financial status changed) — nothing about
    // our internal workflow should move.
    vi.mocked(fetchShopifyOrder).mockResolvedValue(
      buildRawOrder({ id: raw.id, displayFinancialStatus: "PARTIALLY_REFUNDED" }),
    );
    await importShopifyOrder(shop.id, raw.id);

    const order = await db.shopifyOrder.findUniqueOrThrow({ where: { id: created.orderId } });
    expect(order.workflowStatus).toBe("PROOFING_IN_PROGRESS");
    expect(order.priority).toBe("URGENT");
    expect(order.financialStatus).toBe("PARTIALLY_REFUNDED");

    const notes = await db.orderNote.findMany({ where: { orderId: created.orderId } });
    expect(notes).toHaveLength(1);
  });

  it("records an ORDER_CANCELLED activity event and preserves order lines on cancellation", async () => {
    const shop = await getShop();
    const raw = buildRawOrder();
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);
    const created = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(created.orderId);

    vi.mocked(fetchShopifyOrder).mockResolvedValue(
      buildRawOrder({ id: raw.id, cancelledAt: "2026-07-05T00:00:00Z", cancelReason: "CUSTOMER" }),
    );
    const result = await importShopifyOrder(shop.id, raw.id);

    expect(result.wasCancelledJustNow).toBe(true);

    const order = await db.shopifyOrder.findUniqueOrThrow({
      where: { id: created.orderId },
      include: { lines: true, activity: true },
    });
    expect(order.cancelledAt).not.toBeNull();
    expect(order.cancelReason).toBe("CUSTOMER");
    expect(order.lines).toHaveLength(1); // not deleted
    expect(order.activity.some((e) => e.eventType === "ORDER_CANCELLED")).toBe(true);
  });

  it("imports multiple order lines correctly", async () => {
    const shop = await getShop();
    const raw = buildRawOrder({
      lineItems: [
        {
          id: "gid://shopify/LineItem/A",
          title: "Cap",
          variantTitle: null,
          sku: "CAP",
          quantity: 1,
          fulfillableQuantity: 1,
          customAttributes: [],
          product: null,
          variant: null,
        },
        {
          id: "gid://shopify/LineItem/B",
          title: "Shirt",
          variantTitle: "Large",
          sku: "SHIRT-L",
          quantity: 3,
          fulfillableQuantity: 3,
          customAttributes: [],
          product: null,
          variant: null,
        },
      ],
    });
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const result = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(result.orderId);

    const lines = await db.shopifyOrderLine.findMany({ where: { orderId: result.orderId } });
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.sku).sort()).toEqual(["CAP", "SHIRT-L"]);
  });

  it("selects the variant image over the product image, and falls back when the variant has none", async () => {
    const shop = await getShop();
    const raw = buildRawOrder({
      lineItems: [
        {
          id: "gid://shopify/LineItem/with-variant-image",
          title: "Cap",
          variantTitle: null,
          sku: "CAP",
          quantity: 1,
          fulfillableQuantity: 1,
          customAttributes: [],
          product: {
            id: "gid://shopify/Product/1",
            featuredImage: { url: "https://cdn.shopify.com/product.png" },
          },
          variant: {
            id: "gid://shopify/ProductVariant/1",
            barcode: null,
            image: { url: "https://cdn.shopify.com/variant.png" },
          },
        },
        {
          id: "gid://shopify/LineItem/no-image-at-all",
          title: "Shirt",
          variantTitle: null,
          sku: "SHIRT",
          quantity: 1,
          fulfillableQuantity: 1,
          customAttributes: [],
          product: null,
          variant: null,
        },
      ],
    });
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const result = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(result.orderId);

    const lines = await db.shopifyOrderLine.findMany({
      where: { orderId: result.orderId },
      orderBy: { sku: "asc" },
    });
    // Alphabetical: CAP, then SHIRT.
    expect(lines[0]?.imageUrl).toBe("https://cdn.shopify.com/variant.png"); // CAP — variant wins
    expect(lines[1]?.imageUrl).toBeNull(); // SHIRT — no image at all
  });

  it("preserves every custom attribute exactly, including original ordering", async () => {
    const shop = await getShop();
    const raw = buildRawOrder({
      lineItems: [
        {
          id: "gid://shopify/LineItem/attrs",
          title: "Cap",
          variantTitle: null,
          sku: "CAP",
          quantity: 1,
          fulfillableQuantity: 1,
          customAttributes: [
            { key: "Name on cap", value: "Jane" },
            { key: "Position", value: "Front centre" },
          ],
          product: null,
          variant: null,
        },
      ],
    });
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const result = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(result.orderId);

    const line = await db.shopifyOrderLine.findFirstOrThrow({ where: { orderId: result.orderId } });
    const properties = await db.shopifyLineProperty.findMany({
      where: { orderLineId: line.id },
      orderBy: { sortOrder: "asc" },
    });

    expect(properties).toHaveLength(2);
    expect(properties[0]).toMatchObject({ name: "Name on cap", value: "Jane", sortOrder: 0 });
    expect(properties[1]).toMatchObject({ name: "Position", value: "Front centre", sortOrder: 1 });
  });

  it("creates a CustomerArtworkAsset and links it to the exact order line for an OPTIS-style upload URL", async () => {
    const shop = await getShop();
    const uploadUrl = `https://cdn.shopify.com/s/files/1/logo-${randomUUID()}.png`;
    const raw = buildRawOrder({
      lineItems: [
        {
          id: "gid://shopify/LineItem/with-upload",
          title: "Cap",
          variantTitle: null,
          sku: "CAP",
          quantity: 1,
          fulfillableQuantity: 1,
          customAttributes: [{ key: "Logo Upload", value: uploadUrl }],
          product: null,
          variant: null,
        },
      ],
    });
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const result = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(result.orderId);

    const line = await db.shopifyOrderLine.findFirstOrThrow({ where: { orderId: result.orderId } });
    const link = await db.artworkOrderLineLink.findFirst({
      where: { orderLineId: line.id },
      include: { asset: true },
    });

    expect(link).not.toBeNull();
    expect(link?.asset.sourceUrl).toBe(uploadUrl);
    expect(link?.asset.sourceType).toBe("EXTERNAL_REFERENCE");
    expect(link?.asset.storageKey).toBeNull(); // not downloaded

    const property = await db.shopifyLineProperty.findFirstOrThrow({
      where: { orderLineId: line.id },
    });
    expect(property.detectedType).toBe("FILE_UPLOAD");
    expect(property.parsedAssetId).toBe(link?.assetId);
  });

  it("keeps uploads on different order lines correctly separated, not merged into one gallery", async () => {
    const shop = await getShop();
    const uploadA = `https://cdn.shopify.com/s/files/1/a-${randomUUID()}.png`;
    const uploadB = `https://cdn.shopify.com/s/files/1/b-${randomUUID()}.png`;
    const raw = buildRawOrder({
      lineItems: [
        {
          id: "gid://shopify/LineItem/line-a",
          title: "Cap",
          variantTitle: null,
          sku: "CAP",
          quantity: 1,
          fulfillableQuantity: 1,
          customAttributes: [{ key: "Logo", value: uploadA }],
          product: null,
          variant: null,
        },
        {
          id: "gid://shopify/LineItem/line-b",
          title: "Shirt",
          variantTitle: null,
          sku: "SHIRT",
          quantity: 1,
          fulfillableQuantity: 1,
          customAttributes: [{ key: "Logo", value: uploadB }],
          product: null,
          variant: null,
        },
      ],
    });
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const result = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(result.orderId);

    const lineA = await db.shopifyOrderLine.findFirstOrThrow({
      where: { orderId: result.orderId, sku: "CAP" },
    });
    const lineB = await db.shopifyOrderLine.findFirstOrThrow({
      where: { orderId: result.orderId, sku: "SHIRT" },
    });

    const linkA = await db.artworkOrderLineLink.findFirstOrThrow({
      where: { orderLineId: lineA.id },
      include: { asset: true },
    });
    const linkB = await db.artworkOrderLineLink.findFirstOrThrow({
      where: { orderLineId: lineB.id },
      include: { asset: true },
    });

    expect(linkA.asset.sourceUrl).toBe(uploadA);
    expect(linkB.asset.sourceUrl).toBe(uploadB);
    expect(linkA.assetId).not.toBe(linkB.assetId);
  });

  it("handles missing optional customer information without failing", async () => {
    const shop = await getShop();
    const raw = buildRawOrder({ customer: null, shippingAddress: null, billingAddress: null });
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const result = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(result.orderId);

    const order = await db.shopifyOrder.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(order.customerEmail).toBeNull();
    expect(order.customerName).toBeNull();
  });

  it("does not create a duplicate activity event when a re-sync makes no material change", async () => {
    const shop = await getShop();
    const raw = buildRawOrder();
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const created = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(created.orderId);

    vi.mocked(fetchShopifyOrder).mockResolvedValue(buildRawOrder({ id: raw.id }));
    const second = await importShopifyOrder(shop.id, raw.id);

    expect(second.changeDescriptions).toEqual([]);

    const activityCount = await db.activityEvent.count({ where: { orderId: created.orderId } });
    expect(activityCount).toBe(1); // only the original ORDER_IMPORTED event
  });

  it("moves an in-flight order to Fulfilled when Shopify shows it fulfilled directly (bypassing the Hub)", async () => {
    const shop = await getShop();
    const raw = buildRawOrder();
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);
    const created = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(created.orderId);

    await db.shopifyOrder.update({
      where: { id: created.orderId },
      data: { workflowStatus: "READY_TO_PACK" },
    });

    vi.mocked(fetchShopifyOrder).mockResolvedValue(
      buildRawOrder({ id: raw.id, displayFulfillmentStatus: "FULFILLED" }),
    );
    const result = await importShopifyOrder(shop.id, raw.id);

    expect(result.wasFulfilledJustNow).toBe(true);

    const order = await db.shopifyOrder.findUniqueOrThrow({
      where: { id: created.orderId },
      include: { activity: true },
    });
    expect(order.workflowStatus).toBe("FULFILLED");
    expect(order.workflowStatusChangedAt).not.toBeNull();
    expect(order.activity.some((e) => e.eventType === "ORDER_FULFILLED_IN_SHOPIFY")).toBe(true);
  });

  it("does not auto-move an order already in a special status, even if Shopify shows it fulfilled", async () => {
    const shop = await getShop();
    const raw = buildRawOrder();
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);
    const created = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(created.orderId);

    await db.shopifyOrder.update({
      where: { id: created.orderId },
      data: { workflowStatus: "ON_HOLD" },
    });

    vi.mocked(fetchShopifyOrder).mockResolvedValue(
      buildRawOrder({ id: raw.id, displayFulfillmentStatus: "FULFILLED" }),
    );
    const result = await importShopifyOrder(shop.id, raw.id);

    expect(result.wasFulfilledJustNow).toBe(false);

    const order = await db.shopifyOrder.findUniqueOrThrow({ where: { id: created.orderId } });
    expect(order.workflowStatus).toBe("ON_HOLD");
  });

  it("marks a brand-new order Fulfilled immediately if it arrives already fulfilled in Shopify, alongside the import event", async () => {
    const shop = await getShop();
    const raw = buildRawOrder({ displayFulfillmentStatus: "FULFILLED" });
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);

    const result = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(result.orderId);

    expect(result.wasFulfilledJustNow).toBe(true);

    const order = await db.shopifyOrder.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { activity: true },
    });
    expect(order.workflowStatus).toBe("FULFILLED");
    expect(order.activity.some((e) => e.eventType === "ORDER_IMPORTED")).toBe(true);
    expect(order.activity.some((e) => e.eventType === "ORDER_FULFILLED_IN_SHOPIFY")).toBe(true);
  });

  it("records a specific activity event when Shopify tags change", async () => {
    const shop = await getShop();
    const raw = buildRawOrder({ tags: ["preorder"] });
    vi.mocked(fetchShopifyOrder).mockResolvedValue(raw);
    const created = await importShopifyOrder(shop.id, raw.id);
    createdOrderIds.push(created.orderId);

    vi.mocked(fetchShopifyOrder).mockResolvedValue(
      buildRawOrder({ id: raw.id, tags: ["preorder", "urgent"] }),
    );
    await importShopifyOrder(shop.id, raw.id);

    const events = await db.activityEvent.findMany({ where: { orderId: created.orderId } });
    expect(events.some((e) => e.summary.includes("Shopify tags changed"))).toBe(true);
  });
});
