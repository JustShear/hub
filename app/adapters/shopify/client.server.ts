import { env } from "~/lib/env.server";

export class ShopifyGraphQLError extends Error {
  readonly errors?: unknown;
  readonly status?: number;

  constructor(message: string, options?: { errors?: unknown; status?: number }) {
    super(message);
    this.name = "ShopifyGraphQLError";
    this.errors = options?.errors;
    this.status = options?.status;
  }
}

export interface ShopifyGraphQLClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
}

interface ShopifyGraphQLResponse<TData> {
  data?: TData;
  errors?: unknown;
}

// Single authenticated GraphQL request. Callers (orders.server.ts, and later
// tag sync etc.) build the query/variables; this only owns the HTTP + error
// shape so every caller gets the same failure handling.
export async function shopifyGraphQLRequest<TData>(
  options: ShopifyGraphQLClientOptions,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  const apiVersion = options.apiVersion ?? env.SHOPIFY_API_VERSION;
  const url = `https://${options.shopDomain}/admin/api/${apiVersion}/graphql.json`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": options.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw new ShopifyGraphQLError("Failed to reach the Shopify Admin API", { errors: error });
  }

  if (!response.ok) {
    throw new ShopifyGraphQLError(`Shopify GraphQL request failed with status ${response.status}`, {
      status: response.status,
    });
  }

  const json = (await response.json()) as ShopifyGraphQLResponse<TData>;

  if (json.errors) {
    throw new ShopifyGraphQLError("Shopify GraphQL request returned errors", {
      errors: json.errors,
    });
  }

  if (!json.data) {
    throw new ShopifyGraphQLError("Shopify GraphQL request returned no data");
  }

  return json.data;
}
