import { db } from "~/lib/db.server";
import { shopifyGraphQLRequest, ShopifyGraphQLError } from "~/adapters/shopify/client.server";
import {
  recordIntegrationFailure,
  recordIntegrationSuccessAfterFailure,
} from "~/domain/integrations/record-failure.server";

const GET_FULFILLMENT_ORDERS_QUERY = `
  query GetFulfillmentOrders($id: ID!) {
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
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
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

export interface SyncFreightTrackingToShopifyInput {
  shopId: string;
  freightShipmentId: string;
  staffUserId: string;
}

export type SyncFreightTrackingToShopifyResult =
  | { outcome: "synced"; shopifyFulfillmentId: string }
  | { outcome: "already_synced" }
  | { outcome: "rejected"; reason: string };

/**
 * The first-ever Shopify WRITE this app makes (every prior milestone only
 * read from Shopify). Deliberately a separate, independently-retryable step
 * from freight-shipment creation itself — a failure here must never undo a
 * shipment that has already genuinely happened with the carrier. Never
 * throws under normal operation: a Shopify-side failure is recorded via the
 * existing IntegrationFailure/IntegrationType.STARSHIPIT mechanism (the same
 * queue Klaviyo failures already use), not surfaced as an unhandled error.
 * `notifyCustomer: false` is deliberate and permanent for this milestone —
 * customer shipping notifications are explicitly out of scope (Milestones
 * 09–11 carried the same exclusion).
 */
export async function syncFreightTrackingToShopify(
  input: SyncFreightTrackingToShopifyInput,
): Promise<SyncFreightTrackingToShopifyResult> {
  const shipment = await db.freightShipment.findFirst({
    where: { id: input.freightShipmentId, shopId: input.shopId },
    include: { order: { include: { shop: true } } },
  });
  if (!shipment) {
    return { outcome: "rejected", reason: "Freight shipment not found." };
  }
  if (shipment.shopifyFulfillmentId) {
    return { outcome: "already_synced" };
  }
  if (shipment.status !== "CREATED" || !shipment.trackingNumber) {
    return { outcome: "rejected", reason: "This shipment doesn't have a tracking number yet." };
  }

  const clientOptions = {
    shopDomain: shipment.order.shop.shopifyDomain,
    accessToken: shipment.order.shop.adminApiToken,
  };

  try {
    const fulfillmentOrdersData = await shopifyGraphQLRequest<GetFulfillmentOrdersResponse>(
      clientOptions,
      GET_FULFILLMENT_ORDERS_QUERY,
      { id: shipment.order.shopifyOrderGid },
    );
    const fulfillmentOrder = fulfillmentOrdersData.order?.fulfillmentOrders.nodes.find(
      (node) => node.status === "OPEN",
    );
    if (!fulfillmentOrder) {
      await recordIntegrationFailure({
        shopId: input.shopId,
        integration: "STARSHIPIT",
        action: "freight_tracking_sync",
        relatedOrderId: shipment.orderId,
        summary: "No open Shopify fulfillment order was found to attach tracking to.",
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
          trackingInfo: {
            number: shipment.trackingNumber,
            company: shipment.carrierName,
            url: shipment.trackingUrl,
          },
          lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fulfillmentOrder.id }],
        },
      },
    );

    if (result.fulfillmentCreate.userErrors.length > 0) {
      const summary = result.fulfillmentCreate.userErrors.map((e) => e.message).join("; ");
      await recordIntegrationFailure({
        shopId: input.shopId,
        integration: "STARSHIPIT",
        action: "freight_tracking_sync",
        relatedOrderId: shipment.orderId,
        summary: `Shopify rejected the fulfillment: ${summary}`,
        severity: "MEDIUM",
        retryable: false,
      });
      return { outcome: "rejected", reason: summary };
    }

    const fulfillmentId = result.fulfillmentCreate.fulfillment?.id;
    if (!fulfillmentId) {
      await recordIntegrationFailure({
        shopId: input.shopId,
        integration: "STARSHIPIT",
        action: "freight_tracking_sync",
        relatedOrderId: shipment.orderId,
        summary: "Shopify accepted the fulfillment request but returned no fulfillment id.",
        severity: "MEDIUM",
        retryable: true,
      });
      return { outcome: "rejected", reason: "Shopify returned no fulfillment id." };
    }

    await db.$transaction([
      db.freightShipment.update({
        where: { id: shipment.id },
        data: { shopifyFulfillmentId: fulfillmentId },
      }),
      db.shopifyOrder.update({
        where: { id: shipment.orderId },
        data: { workflowStatus: "FULFILLED", workflowStatusChangedAt: new Date() },
      }),
    ]);
    await recordIntegrationSuccessAfterFailure(
      input.shopId,
      "STARSHIPIT",
      "freight_tracking_sync",
      shipment.orderId,
    );

    return { outcome: "synced", shopifyFulfillmentId: fulfillmentId };
  } catch (error) {
    const isShopifyError = error instanceof ShopifyGraphQLError;
    await recordIntegrationFailure({
      shopId: input.shopId,
      integration: "STARSHIPIT",
      action: "freight_tracking_sync",
      relatedOrderId: shipment.orderId,
      summary: "Failed to sync tracking information to Shopify.",
      technicalDetail: isShopifyError ? error.message : String(error),
      severity: "MEDIUM",
      retryable: true,
    });
    return { outcome: "rejected", reason: "Failed to sync tracking information to Shopify." };
  }
}
