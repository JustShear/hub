// Development-only tool for manually importing (or re-importing) a single
// Shopify order. Deliberately calls the exact same import-order.server.ts
// service that the webhooks use — no separate import implementation.
//
// Usage:
//   npm run import:order -- "gid://shopify/Order/1234567890"
//   npm run import:order -- "#1001"
//   npm run import:order -- 1001

import { db } from "../app/lib/db.server";
import { shopifyGraphQLRequest } from "../app/adapters/shopify/client.server";
import { importShopifyOrder } from "../app/domain/orders/import-order.server";

interface FindOrderByNameResponse {
  orders: { edges: { node: { id: string } }[] };
}

async function resolveOrderGid(
  shop: { shopifyDomain: string; adminApiToken: string },
  identifier: string,
): Promise<string> {
  if (identifier.startsWith("gid://shopify/Order/")) {
    return identifier;
  }

  const name = identifier.startsWith("#") ? identifier : `#${identifier}`;
  const data = await shopifyGraphQLRequest<FindOrderByNameResponse>(
    { shopDomain: shop.shopifyDomain, accessToken: shop.adminApiToken },
    `query FindOrderByName($searchQuery: String!) {
      orders(first: 1, query: $searchQuery) {
        edges { node { id } }
      }
    }`,
    { searchQuery: `name:${name}` },
  );

  const match = data.orders.edges[0]?.node.id;
  if (!match) {
    throw new Error(`No Shopify order found matching "${identifier}"`);
  }
  return match;
}

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error('Usage: npm run import:order -- "<shopify-order-gid-or-name>"');
    process.exitCode = 1;
    return;
  }

  const shop = await db.shop.findFirstOrThrow();
  const orderGid = await resolveOrderGid(shop, identifier);

  console.log(`Importing ${orderGid}...`);
  const result = await importShopifyOrder(shop.id, orderGid);

  console.log(
    `Done. orderId=${result.orderId} wasNewOrder=${result.wasNewOrder} wasCancelledJustNow=${result.wasCancelledJustNow}`,
  );
  if (result.changeDescriptions.length > 0) {
    console.log(`Changes detected: ${result.changeDescriptions.join(", ")}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
