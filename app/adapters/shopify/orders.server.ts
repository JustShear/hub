import {
  shopifyGraphQLRequest,
  type ShopifyGraphQLClientOptions,
} from "~/adapters/shopify/client.server";
import {
  paginateConnection,
  type GraphQLConnectionPage,
} from "~/adapters/shopify/pagination.server";

const LINE_ITEMS_PAGE_SIZE = 50;

// Fields we're highly confident are stable, long-standing parts of the
// Admin GraphQL Order/LineItem types. Exact field names should still be
// validated against a live introspection/GraphiQL session before this goes
// near a real store — see docs/development.md "Known limitations".
const ORDER_QUERY = /* GraphQL */ `
  query GetOrder($id: ID!, $lineItemsCursor: String) {
    order(id: $id) {
      id
      legacyResourceId
      name
      createdAt
      updatedAt
      cancelledAt
      cancelReason
      displayFinancialStatus
      displayFulfillmentStatus
      tags
      note
      customer {
        id
        email
        phone
        displayName
      }
      shippingAddress {
        name
        address1
        address2
        city
        provinceCode
        zip
        countryCodeV2
        phone
      }
      billingAddress {
        name
        address1
        address2
        city
        provinceCode
        zip
        countryCodeV2
        phone
      }
      shippingLine {
        title
      }
      currencyCode
      subtotalPriceSet {
        shopMoney {
          amount
        }
      }
      totalPriceSet {
        shopMoney {
          amount
        }
      }
      totalDiscountsSet {
        shopMoney {
          amount
        }
      }
      totalTaxSet {
        shopMoney {
          amount
        }
      }
      discountCodes
      lineItems(first: ${LINE_ITEMS_PAGE_SIZE}, after: $lineItemsCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            variantTitle
            sku
            quantity
            fulfillableQuantity
            customAttributes {
              key
              value
            }
            product {
              id
              featuredImage {
                url
              }
            }
            variant {
              id
              barcode
              image {
                url
              }
            }
          }
        }
      }
      fulfillments(first: 25) {
        id
        status
        createdAt
        trackingInfo {
          number
          url
          company
        }
      }
    }
  }
`;

const ORDER_LINE_ITEMS_PAGE_QUERY = /* GraphQL */ `
  query GetOrderLineItemsPage($id: ID!, $lineItemsCursor: String) {
    order(id: $id) {
      lineItems(first: ${LINE_ITEMS_PAGE_SIZE}, after: $lineItemsCursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            variantTitle
            sku
            quantity
            fulfillableQuantity
            customAttributes {
              key
              value
            }
            product {
              id
              featuredImage {
                url
              }
            }
            variant {
              id
              barcode
              image {
                url
              }
            }
          }
        }
      }
    }
  }
`;

export interface RawShopifyMoney {
  amount: string;
}

export interface RawShopifyAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  zip: string | null;
  countryCodeV2: string | null;
  phone: string | null;
}

export interface RawShopifyLineItemAttribute {
  key: string;
  // Shopify's Admin GraphQL schema declares this nullable (confirmed against
  // real order data — a custom attribute can have a null value, e.g. a
  // cleared OPTIS property) even though it's easy to assume otherwise.
  value: string | null;
}

export interface RawShopifyLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  fulfillableQuantity: number | null;
  customAttributes: RawShopifyLineItemAttribute[];
  product: { id: string; featuredImage: { url: string } | null } | null;
  variant: { id: string; barcode: string | null; image: { url: string } | null } | null;
}

export interface RawShopifyFulfillment {
  id: string;
  status: string;
  createdAt: string;
  trackingInfo: { number: string | null; url: string | null; company: string | null }[];
}

const OPEN_ORDER_GIDS_QUERY = /* GraphQL */ `
  query GetOpenOrderGids($cursor: String) {
    orders(first: 100, after: $cursor, query: "status:open") {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
        }
      }
    }
  }
`;

interface OpenOrderGidsQueryResponse {
  orders: GraphQLConnectionPage<{ id: string }>;
}

// Lists every currently-open order's GID (Shopify's "not archived/cancelled"
// definition of open) — deliberately lightweight (id only, no line items) so
// a one-time historical backfill can enumerate what to import without
// pulling full order payloads for orders it may skip. Pair with
// importShopifyOrder for the actual per-order fetch+write.
export async function fetchOpenShopifyOrderGids(
  client: ShopifyGraphQLClientOptions,
): Promise<string[]> {
  const nodes = await paginateConnection<{ id: string }>(async (cursor) => {
    const page = await shopifyGraphQLRequest<OpenOrderGidsQueryResponse>(
      client,
      OPEN_ORDER_GIDS_QUERY,
      { cursor },
    );
    return page.orders;
  });
  return nodes.map((node) => node.id);
}

export interface RawShopifyOrder {
  id: string;
  legacyResourceId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  tags: string[];
  note: string | null;
  customer: { id: string; email: string | null; phone: string | null; displayName: string } | null;
  shippingAddress: RawShopifyAddress | null;
  billingAddress: RawShopifyAddress | null;
  shippingLine: { title: string } | null;
  currencyCode: string;
  subtotalPriceSet: { shopMoney: RawShopifyMoney } | null;
  totalPriceSet: { shopMoney: RawShopifyMoney } | null;
  totalDiscountsSet: { shopMoney: RawShopifyMoney } | null;
  totalTaxSet: { shopMoney: RawShopifyMoney } | null;
  discountCodes: string[];
  lineItems: RawShopifyLineItem[];
  fulfillments: RawShopifyFulfillment[];
}

interface OrderQueryResponse {
  order:
    | (Omit<RawShopifyOrder, "lineItems"> & {
        lineItems: GraphQLConnectionPage<RawShopifyLineItem>;
      })
    | null;
}

interface LineItemsPageQueryResponse {
  order: { lineItems: GraphQLConnectionPage<RawShopifyLineItem> } | null;
}

// The single place that knows how to fetch a complete order (all line item
// pages included) from Shopify. Used by the import service — never call
// shopifyGraphQLRequest directly from anywhere that needs an order.
export async function fetchShopifyOrder(
  client: ShopifyGraphQLClientOptions,
  shopifyOrderGid: string,
): Promise<RawShopifyOrder | null> {
  const firstPage = await shopifyGraphQLRequest<OrderQueryResponse>(client, ORDER_QUERY, {
    id: shopifyOrderGid,
    lineItemsCursor: null,
  });

  if (!firstPage.order) {
    return null;
  }

  const { lineItems: firstLineItemsPage, ...orderFields } = firstPage.order;

  const lineItems = await paginateConnection<RawShopifyLineItem>(async (cursor) => {
    if (cursor === null) {
      return firstLineItemsPage;
    }

    const page = await shopifyGraphQLRequest<LineItemsPageQueryResponse>(
      client,
      ORDER_LINE_ITEMS_PAGE_QUERY,
      { id: shopifyOrderGid, lineItemsCursor: cursor },
    );

    if (!page.order) {
      return { edges: [], pageInfo: { hasNextPage: false, endCursor: null } };
    }

    return page.order.lineItems;
  });

  return { ...orderFields, lineItems };
}
