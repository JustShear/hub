import { afterEach, describe, expect, it, vi } from "vitest";
import { shopifyGraphQLRequest, ShopifyGraphQLError } from "~/adapters/shopify/client.server";

const CLIENT_OPTIONS = {
  shopDomain: "test-store.myshopify.com",
  accessToken: "shpat_test",
  apiVersion: "2026-07",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("shopifyGraphQLRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns data on a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: { order: { id: "gid://shopify/Order/1" } } })),
    );

    const data = await shopifyGraphQLRequest<{ order: { id: string } }>(CLIENT_OPTIONS, "query {}");

    expect(data.order.id).toBe("gid://shopify/Order/1");
  });

  it("sends the access token and API version in the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await shopifyGraphQLRequest(CLIENT_OPTIONS, "query {}");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test-store.myshopify.com/admin/api/2026-07/graphql.json");
    expect((init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("shpat_test");
  });

  it("throws ShopifyGraphQLError on a non-2xx HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 })));

    await expect(shopifyGraphQLRequest(CLIENT_OPTIONS, "query {}")).rejects.toBeInstanceOf(
      ShopifyGraphQLError,
    );
  });

  it("throws ShopifyGraphQLError when the response body contains GraphQL errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: "Field does not exist" }] })),
    );

    await expect(shopifyGraphQLRequest(CLIENT_OPTIONS, "query {}")).rejects.toThrow(
      /returned errors/,
    );
  });

  it("throws ShopifyGraphQLError when the network request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));

    await expect(shopifyGraphQLRequest(CLIENT_OPTIONS, "query {}")).rejects.toThrow(
      /Failed to reach the Shopify Admin API/,
    );
  });
});
