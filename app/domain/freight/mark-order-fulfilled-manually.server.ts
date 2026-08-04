import { ActorType, OrderStatus } from "@prisma/client";
import { db } from "~/lib/db.server";
import { shopifyGraphQLRequest, ShopifyGraphQLError } from "~/adapters/shopify/client.server";
import {
  recordIntegrationFailure,
  recordIntegrationSuccessAfterFailure,
} from "~/domain/integrations/record-failure.server";

const GET_FULFILLMENT_ORDERS_QUERY = `
  query GetFulfillmentOrdersForManualFulfillment($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
        }
      }
    }
  }
`;

interface GetFulfillmentOrdersResponse {
  order: { fulfillmentOrders: { nodes: { id: string; status: string }[] } } | null;
}

const FULFILLMENT_CREATE_MUTATION = `
  mutation FulfillmentCreateNoTracking($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface FulfillmentCreateResponse {
  fulfillmentCreate: {
    fulfillment: { id: string } | null;
    userErrors: { field: string[] | null; message: string }[];
  };
}

const ELIGIBLE_STATUSES: OrderStatus[] = [OrderStatus.READY_TO_PACK, OrderStatus.PACKING];

export interface MarkOrderFulfilledManuallyInput {
  shopId: string;
  orderId: string;
  staffUserId: string;
}

export type MarkOrderFulfilledManuallyResult =
  | { outcome: "fulfilled" }
  | { outcome: "rejected"; reason: string };

/**
 * The "no label" counterpart to createFreightShipment — for orders that
 * don't need shipping (local pickup, hand delivery, or a carrier this app
 * doesn't integrate with). Marks the order FULFILLED in the Hub and also
 * fulfils it in Shopify (no tracking info attached), so Shopify's own
 * unfulfilled-orders view stays accurate rather than showing these
 * indefinitely. Deliberately bypasses FreightShipment/Starshipit entirely —
 * see docs/decisions/0008-starshipit-freight-integration.md's "no packing
 * gate" note, which this mirrors: staff are trusted to only use this once
 * the order is genuinely ready to go out.
 */
export async function markOrderFulfilledManually(
  input: MarkOrderFulfilledManuallyInput,
): Promise<MarkOrderFulfilledManuallyResult> {
  const order = await db.shopifyOrder.findFirst({
    where: { id: input.orderId, shopId: input.shopId },
    include: { shop: true },
  });
  if (!order) {
    return { outcome: "rejected", reason: "Order not found." };
  }
  if (!ELIGIBLE_STATUSES.includes(order.workflowStatus)) {
    return { outcome: "rejected", reason: "This order isn't ready to pack yet." };
  }

  const clientOptions = {
    shopDomain: order.shop.shopifyDomain,
    accessToken: order.shop.adminApiToken,
  };

  try {
    const fulfillmentOrdersData = await shopifyGraphQLRequest<GetFulfillmentOrdersResponse>(
      clientOptions,
      GET_FULFILLMENT_ORDERS_QUERY,
      { id: order.shopifyOrderGid },
    );
    const fulfillmentOrder = fulfillmentOrdersData.order?.fulfillmentOrders.nodes.find(
      (node) => node.status === "OPEN",
    );
    if (!fulfillmentOrder) {
      await recordIntegrationFailure({
        shopId: input.shopId,
        integration: "SHOPIFY_FULFILLMENT",
        action: "manual_fulfillment",
        relatedOrderId: order.id,
        summary: "No open Shopify fulfillment order was found to mark fulfilled.",
        severity: "MEDIUM",
        retryable: false,
      });
      return {
        outcome: "rejected",
        reason: "No open Shopify fulfillment order was found for this order.",
      };
    }

    const result = await shopifyGraphQLRequest<FulfillmentCreateResponse>(
      clientOptions,
      FULFILLMENT_CREATE_MUTATION,
      {
        fulfillment: {
          notifyCustomer: false,
          lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fulfillmentOrder.id }],
        },
      },
    );

    if (result.fulfillmentCreate.userErrors.length > 0) {
      const summary = result.fulfillmentCreate.userErrors.map((e) => e.message).join("; ");
      await recordIntegrationFailure({
        shopId: input.shopId,
        integration: "SHOPIFY_FULFILLMENT",
        action: "manual_fulfillment",
        relatedOrderId: order.id,
        summary: `Shopify rejected the fulfillment: ${summary}`,
        severity: "MEDIUM",
        retryable: false,
      });
      return { outcome: "rejected", reason: summary };
    }

    if (!result.fulfillmentCreate.fulfillment?.id) {
      await recordIntegrationFailure({
        shopId: input.shopId,
        integration: "SHOPIFY_FULFILLMENT",
        action: "manual_fulfillment",
        relatedOrderId: order.id,
        summary: "Shopify accepted the fulfillment request but returned no fulfillment id.",
        severity: "MEDIUM",
        retryable: true,
      });
      return { outcome: "rejected", reason: "Shopify returned no fulfillment id." };
    }

    await db.$transaction([
      db.shopifyOrder.update({
        where: { id: order.id },
        data: { workflowStatus: OrderStatus.FULFILLED, workflowStatusChangedAt: new Date() },
      }),
      db.activityEvent.create({
        data: {
          shopId: input.shopId,
          orderId: order.id,
          entityType: "ShopifyOrder",
          entityId: order.id,
          eventType: "order_fulfilled_manually",
          summary: `Order ${order.orderNumber} marked fulfilled without a freight label`,
          metadata: { source: "manual_no_label" },
          actorStaffId: input.staffUserId,
          actorType: ActorType.STAFF,
        },
      }),
    ]);
    await recordIntegrationSuccessAfterFailure(
      input.shopId,
      "SHOPIFY_FULFILLMENT",
      "manual_fulfillment",
      order.id,
    );

    return { outcome: "fulfilled" };
  } catch (error) {
    const isShopifyError = error instanceof ShopifyGraphQLError;
    await recordIntegrationFailure({
      shopId: input.shopId,
      integration: "SHOPIFY_FULFILLMENT",
      action: "manual_fulfillment",
      relatedOrderId: order.id,
      summary: "Failed to mark the order fulfilled in Shopify.",
      technicalDetail: isShopifyError ? error.message : String(error),
      severity: "MEDIUM",
      retryable: true,
    });
    return { outcome: "rejected", reason: "Failed to mark the order fulfilled in Shopify." };
  }
}
