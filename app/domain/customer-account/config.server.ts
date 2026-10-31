import { env } from "~/lib/env.server";

export interface CustomerAccountConfig {
  clientId: string;
  secret: string;
  baseUrl: string;
}

/**
 * Null when the customer-account page isn't switched on (no SHOPIFY_CLIENT_ID
 * set). The routes answer 503 in that case, so deploying this code changes
 * nothing about the live Hub until the variable is added.
 */
export function getCustomerAccountConfig(): CustomerAccountConfig | null {
  if (!env.SHOPIFY_CLIENT_ID) {
    return null;
  }
  return {
    clientId: env.SHOPIFY_CLIENT_ID,
    secret: env.SHOPIFY_EXTENSION_CLIENT_SECRET ?? env.SHOPIFY_API_SECRET_KEY,
    baseUrl: env.APP_BASE_URL,
  };
}

// Customer-account extensions run in a Web Worker with a null origin, so the
// browser will only let them read a response that says `*`. That is safe
// here because the endpoint is authorised by a bearer token in a header, never
// by cookies - there is no ambient credential for another site to ride on.
export const CUSTOMER_ACCOUNT_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;
