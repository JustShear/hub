import { Prisma, ActorType, OrderStatus, type ShopifyOrder, type ShopifyOrderLine } from "@prisma/client";
import { db } from "~/lib/db.server";
import {
  fetchShopifyOrder,
  type RawShopifyAddress,
  type RawShopifyOrder,
} from "~/adapters/shopify/orders.server";
import { parseOptisLineProperties } from "~/domain/orders/optis-property-parser";
import { selectLineImage } from "~/domain/orders/select-line-image";
import { isSpecialStatus } from "~/domain/orders/board-columns";
import { createWarehousePickJobForOrder } from "~/domain/warehouse/create-warehouse-pick-job.server";

export class OrderNotFoundError extends Error {
  constructor(shopifyOrderGid: string) {
    super(`Shopify order ${shopifyOrderGid} was not found (deleted, or access revoked).`);
    this.name = "OrderNotFoundError";
  }
}

export interface ImportShopifyOrderResult {
  orderId: string;
  wasNewOrder: boolean;
  wasCancelledJustNow: boolean;
  wasFulfilledJustNow: boolean;
  wasExportedForPrintJustNow: boolean;
  changeDescriptions: string[];
}

function toDecimal(amount: string | undefined): Prisma.Decimal | null {
  return amount ? new Prisma.Decimal(amount) : null;
}

function addressToJson(
  address: RawShopifyAddress | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return address ? (address as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
}

type ExistingOrderWithLines = ShopifyOrder & { lines: ShopifyOrderLine[] };

// Compares Shopify-owned fields only — never looks at Hub-owned fields,
// since those can't have "changed" from Shopify's perspective. Returns
// human-readable descriptions so activity events are specific rather than a
// generic "something changed".
function detectMaterialChanges(
  existing: ExistingOrderWithLines,
  incoming: RawShopifyOrder,
): string[] {
  const changes: string[] = [];

  const existingTags = [...existing.tags].sort();
  const incomingTags = [...incoming.tags].sort();
  if (JSON.stringify(existingTags) !== JSON.stringify(incomingTags)) {
    changes.push("Shopify tags changed");
  }

  if (existing.financialStatus !== (incoming.displayFinancialStatus ?? null)) {
    changes.push("Financial status changed");
  }

  if (existing.fulfillmentStatus !== (incoming.displayFulfillmentStatus ?? null)) {
    changes.push("Fulfilment status changed");
  }

  const existingLinesByGid = new Map(existing.lines.map((line) => [line.shopifyLineGid, line]));
  let quantityChanged = false;
  let productOrVariantChanged = false;
  let lineAdded = false;

  for (const incomingLine of incoming.lineItems) {
    const existingLine = existingLinesByGid.get(incomingLine.id);
    if (!existingLine) {
      lineAdded = true;
      continue;
    }
    if (existingLine.quantity !== incomingLine.quantity) {
      quantityChanged = true;
    }
    if (
      existingLine.shopifyProductGid !== (incomingLine.product?.id ?? null) ||
      existingLine.shopifyVariantGid !== (incomingLine.variant?.id ?? null)
    ) {
      productOrVariantChanged = true;
    }
  }

  if (quantityChanged) changes.push("Order-line quantity changed");
  if (productOrVariantChanged) changes.push("Product or variant changed on an order line");
  if (lineAdded) changes.push("Order lines added");

  return changes;
}

// The single reusable Shopify order-import service. Every caller — webhooks,
// the dev CLI, and any future manual-refresh/backfill — goes through this;
// nothing else is allowed to duplicate this logic.
export async function importShopifyOrder(
  shopId: string,
  shopifyOrderGid: string,
): Promise<ImportShopifyOrderResult> {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });

  const rawOrder = await fetchShopifyOrder(
    { shopDomain: shop.shopifyDomain, accessToken: shop.adminApiToken },
    shopifyOrderGid,
  );

  if (!rawOrder) {
    throw new OrderNotFoundError(shopifyOrderGid);
  }

  const existingOrder = await db.shopifyOrder.findUnique({
    where: { shopId_shopifyOrderGid: { shopId, shopifyOrderGid } },
    include: { lines: true },
  });

  const wasNewOrder = !existingOrder;
  const wasCancelledJustNow = Boolean(rawOrder.cancelledAt) && !existingOrder?.cancelledAt;

  // Deliberate, narrow exception to "a Shopify sync never overwrites
  // Hub-owned fields": if staff fulfil an order directly in Shopify —
  // outside the Hub entirely, which happens during the migration period
  // while the team is still getting used to the board — the Hub would
  // otherwise never notice, and the card would sit wherever it was
  // forever. Scoped tightly: only fires when Shopify says fully FULFILLED,
  // the order isn't already in a special status (on hold/cancelled/
  // archived/already fulfilled — never silently override those), and it
  // didn't just get cancelled in this same sync.
  const currentWorkflowStatus = existingOrder?.workflowStatus ?? OrderStatus.NEW;
  const wasFulfilledJustNow =
    !wasCancelledJustNow &&
    rawOrder.displayFulfillmentStatus === "FULFILLED" &&
    !isSpecialStatus(currentWorkflowStatus);

  // Same "detect the transition before the upsert" shape as
  // wasFulfilledJustNow above — this is the sync-triggered half of the
  // warehouse pick-job trigger (the other half is the manual drag-to-column
  // path in move-order-workflow-status.server.ts). Whichever fires first
  // wins; createWarehousePickJobForOrder is idempotent, so no risk from both
  // firing for the same order.
  const wasExportedForPrintJustNow =
    !existingOrder?.tags.includes("Exported for Print") &&
    rawOrder.tags.includes("Exported for Print");

  const rawChangeDescriptions = existingOrder ? detectMaterialChanges(existingOrder, rawOrder) : [];
  // Superseded by the dedicated ORDER_FULFILLED_IN_SHOPIFY event below —
  // logging both would say the same real-world thing twice.
  const changeDescriptions = wasFulfilledJustNow
    ? rawChangeDescriptions.filter((d) => d !== "Fulfilment status changed")
    : rawChangeDescriptions;

  const fulfillmentSyncFields = wasFulfilledJustNow
    ? { workflowStatus: OrderStatus.FULFILLED, workflowStatusChangedAt: new Date() }
    : {};

  const shopifyOwnedFields = {
    orderNumber: rawOrder.name,
    shopifyLegacyOrderId: rawOrder.legacyResourceId,
    shopifyCreatedAt: new Date(rawOrder.createdAt),
    shopifyUpdatedAt: new Date(rawOrder.updatedAt),
    customerShopifyGid: rawOrder.customer?.id ?? null,
    customerEmail: rawOrder.customer?.email ?? null,
    customerName: rawOrder.customer?.displayName ?? null,
    customerPhone: rawOrder.customer?.phone ?? null,
    noteFromCustomer: rawOrder.note,
    tags: rawOrder.tags,
    financialStatus: rawOrder.displayFinancialStatus,
    fulfillmentStatus: rawOrder.displayFulfillmentStatus,
    shippingMethod: rawOrder.shippingLine?.title ?? null,
    currencyCode: rawOrder.currencyCode,
    subtotalPrice: toDecimal(rawOrder.subtotalPriceSet?.shopMoney.amount),
    totalPrice: toDecimal(rawOrder.totalPriceSet?.shopMoney.amount),
    totalDiscounts: toDecimal(rawOrder.totalDiscountsSet?.shopMoney.amount),
    totalTax: toDecimal(rawOrder.totalTaxSet?.shopMoney.amount),
    discountCodes: rawOrder.discountCodes as unknown as Prisma.InputJsonValue,
    shippingAddress: addressToJson(rawOrder.shippingAddress),
    billingAddress: addressToJson(rawOrder.billingAddress),
    fulfillments: rawOrder.fulfillments as unknown as Prisma.InputJsonValue,
    cancelledAt: rawOrder.cancelledAt ? new Date(rawOrder.cancelledAt) : null,
    cancelReason: rawOrder.cancelReason,
    rawPayload: rawOrder as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };

  const orderId = await db.$transaction(
    async (tx) => {
      const order = await tx.shopifyOrder.upsert({
        where: { shopId_shopifyOrderGid: { shopId, shopifyOrderGid } },
        create: { shopId, shopifyOrderGid, ...shopifyOwnedFields, ...fulfillmentSyncFields },
        // Hub-owned fields (workflowStatus, proofSummary, priority, and
        // everything else not listed here) are never part of this `update`,
        // so a Shopify sync can never overwrite them — fulfillmentSyncFields
        // is the sole, narrowly-scoped exception (see its definition above).
        update: { ...shopifyOwnedFields, ...fulfillmentSyncFields },
      });

      for (const rawLine of rawOrder.lineItems) {
        const imageUrl = selectLineImage({
          variantImageUrl: rawLine.variant?.image?.url,
          productFeaturedImageUrl: rawLine.product?.featuredImage?.url,
        });

        const lineFields = {
          shopifyProductGid: rawLine.product?.id ?? null,
          shopifyVariantGid: rawLine.variant?.id ?? null,
          productTitle: rawLine.title,
          variantTitle: rawLine.variantTitle,
          sku: rawLine.sku,
          barcode: rawLine.variant?.barcode ?? null,
          quantity: rawLine.quantity,
          fulfilledQuantity:
            rawLine.fulfillableQuantity != null
              ? rawLine.quantity - rawLine.fulfillableQuantity
              : null,
          imageUrl,
        };

        const line = await tx.shopifyOrderLine.upsert({
          where: { orderId_shopifyLineGid: { orderId: order.id, shopifyLineGid: rawLine.id } },
          create: { orderId: order.id, shopifyLineGid: rawLine.id, ...lineFields },
          update: lineFields,
        });

        // Properties are a direct mirror of Shopify's line-item custom
        // attributes — replaced wholesale on each sync. CustomerArtworkAsset
        // and ArtworkOrderLineLink (below) are keyed independently by URL,
        // so this never loses the upload association.
        await tx.shopifyLineProperty.deleteMany({ where: { orderLineId: line.id } });

        const parsedProperties = parseOptisLineProperties(rawLine.customAttributes);

        for (const parsed of parsedProperties) {
          let parsedAssetId: string | null = null;

          if (parsed.detectedType === "FILE_UPLOAD") {
            const asset = await tx.customerArtworkAsset.upsert({
              where: { shopId_sourceUrl: { shopId, sourceUrl: parsed.value } },
              create: {
                shopId,
                sourceUrl: parsed.value,
                sourceType: "EXTERNAL_REFERENCE",
                originalFilename: parsed.value.split("/").pop() ?? null,
              },
              update: {},
            });

            await tx.artworkOrderLineLink.upsert({
              where: { assetId_orderLineId: { assetId: asset.id, orderLineId: line.id } },
              create: { assetId: asset.id, orderLineId: line.id },
              update: {},
            });

            parsedAssetId = asset.id;
          }

          await tx.shopifyLineProperty.create({
            data: {
              orderLineId: line.id,
              name: parsed.name,
              value: parsed.value,
              sortOrder: parsed.sortOrder,
              rawValue: parsed.rawValue as unknown as Prisma.InputJsonValue,
              detectedType: parsed.detectedType,
              parsedAssetId,
            },
          });
        }
      }

      if (wasNewOrder) {
        await tx.proofRequirement.create({
          data: { orderId: order.id, value: "UNDETERMINED" },
        });

        await tx.activityEvent.create({
          data: {
            shopId,
            orderId: order.id,
            entityType: "ShopifyOrder",
            entityId: order.id,
            eventType: "ORDER_IMPORTED",
            summary: `Order ${order.orderNumber} imported from Shopify`,
            actorType: ActorType.SYSTEM,
          },
        });
      } else if (wasCancelledJustNow) {
        await tx.activityEvent.create({
          data: {
            shopId,
            orderId: order.id,
            entityType: "ShopifyOrder",
            entityId: order.id,
            eventType: "ORDER_CANCELLED",
            summary: `Order ${order.orderNumber} was cancelled in Shopify${
              order.cancelReason ? ` (${order.cancelReason})` : ""
            }`,
            actorType: ActorType.SYSTEM,
          },
        });

        // Stop future reminders for anything already sent-pending on this
        // order (Milestone 09's "do not remind a cancelled order" rule).
        await tx.proofReminder.updateMany({
          where: {
            proofRequest: { orderId: order.id },
            sentAt: null,
            suppressed: false,
          },
          data: { suppressed: true, suppressedReason: "Order cancelled in Shopify" },
        });
      } else if (changeDescriptions.length > 0) {
        for (const description of changeDescriptions) {
          await tx.activityEvent.create({
            data: {
              shopId,
              orderId: order.id,
              entityType: "ShopifyOrder",
              entityId: order.id,
              eventType: "ORDER_REFRESHED",
              summary: `${description} (order ${order.orderNumber})`,
              actorType: ActorType.SYSTEM,
            },
          });
        }
      }
      // If nothing changed at all, only lastSyncedAt was touched above —
      // no activity event, so routine re-syncs don't create noise.

      if (wasFulfilledJustNow) {
        // Not an `else if` above — a brand-new order that arrives already
        // fulfilled should get both ORDER_IMPORTED and this event.
        await tx.activityEvent.create({
          data: {
            shopId,
            orderId: order.id,
            entityType: "ShopifyOrder",
            entityId: order.id,
            eventType: "ORDER_FULFILLED_IN_SHOPIFY",
            summary: `Order ${order.orderNumber} was fulfilled directly in Shopify and moved to Fulfilled automatically`,
            metadata: { source: "shopify_fulfillment_sync", previousWorkflowStatus: currentWorkflowStatus },
            actorType: ActorType.SYSTEM,
          },
        });
      }

      if (wasExportedForPrintJustNow) {
        await createWarehousePickJobForOrder(tx, {
          shopId,
          orderId: order.id,
          actorStaffId: null,
        });
      }

      return order.id;
    },
    { timeout: 15_000 },
  );

  return {
    orderId,
    wasNewOrder,
    wasCancelledJustNow,
    wasFulfilledJustNow,
    wasExportedForPrintJustNow,
    changeDescriptions,
  };
}
