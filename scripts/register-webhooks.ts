// One-time (or re-run-after-URL-change) setup: registers this app's webhook
// subscriptions with Shopify via the Admin GraphQL API. There is no OAuth
// install flow in this standalone-app architecture to hook this into
// automatically, so it's a script run deliberately against a real shop.
//
// Usage:
//   npm run register:webhooks -- https://your-deployed-app.example.com

import { db } from "../app/lib/db.server";
import { shopifyGraphQLRequest } from "../app/adapters/shopify/client.server";

const WEBHOOK_TOPICS: { topic: string; path: string }[] = [
  { topic: "ORDERS_CREATE", path: "/webhooks/orders/created" },
  { topic: "ORDERS_UPDATED", path: "/webhooks/orders/updated" },
  { topic: "ORDERS_CANCELLED", path: "/webhooks/orders/cancelled" },
  { topic: "CUSTOMERS_DATA_REQUEST", path: "/webhooks/customers/data-request" },
  { topic: "CUSTOMERS_REDACT", path: "/webhooks/customers/redact" },
  { topic: "SHOP_REDACT", path: "/webhooks/shop/redact" },
];

interface RegisterWebhookResponse {
  webhookSubscriptionCreate: {
    webhookSubscription: { id: string } | null;
    userErrors: { field: string[] | null; message: string }[];
  };
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error("Usage: npm run register:webhooks -- https://your-deployed-app.example.com");
    process.exitCode = 1;
    return;
  }

  const shop = await db.shop.findFirstOrThrow();
  const client = { shopDomain: shop.shopifyDomain, accessToken: shop.adminApiToken };

  for (const { topic, path } of WEBHOOK_TOPICS) {
    const callbackUrl = new URL(path, baseUrl).toString();
    console.log(`Registering ${topic} -> ${callbackUrl}`);

    const result = await shopifyGraphQLRequest<RegisterWebhookResponse>(
      client,
      `mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }`,
      { topic, webhookSubscription: { callbackUrl, format: "JSON" } },
    );

    const { webhookSubscription, userErrors } = result.webhookSubscriptionCreate;
    if (userErrors.length > 0) {
      console.error(`  Failed: ${userErrors.map((e) => e.message).join(", ")}`);
    } else {
      console.log(`  OK: ${webhookSubscription?.id}`);
    }
  }

  console.log(
    "\nMandatory privacy webhooks (customers/data_request, customers/redact, shop/redact) can " +
      "alternatively be configured under Shopify Admin -> Settings -> Notifications -> Compliance " +
      "webhooks, which some Shopify plans require instead of registering them via the API above.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
