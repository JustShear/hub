import { describe, expect, it } from "vitest";
import {
  customerKeyFor,
  customerOrderWhere,
  parseCustomerKey,
} from "~/domain/customers/customer-key";

describe("customerKeyFor", () => {
  it("prefers the Shopify customer id", () => {
    expect(
      customerKeyFor({
        customerShopifyGid: "gid://shopify/Customer/8123",
        customerEmail: "a@example.com",
      }),
    ).toBe("s-8123");
  });

  it("falls back to a lower-cased, URL-safe email for guest checkouts", () => {
    expect(customerKeyFor({ customerShopifyGid: null, customerEmail: " Jo+Test@Example.com " })).toBe(
      "e-jo%2Btest%40example.com",
    );
  });

  it("falls back to email when the gid is not a customer gid", () => {
    expect(
      customerKeyFor({ customerShopifyGid: "gid://shopify/Order/1", customerEmail: "a@b.co" }),
    ).toBe("e-a%40b.co");
  });

  it("returns null when there is nothing to identify the customer by", () => {
    expect(customerKeyFor({ customerShopifyGid: null, customerEmail: null })).toBeNull();
    expect(customerKeyFor({ customerShopifyGid: null, customerEmail: "  " })).toBeNull();
  });
});

describe("parseCustomerKey", () => {
  it("round-trips both key kinds", () => {
    expect(parseCustomerKey("s-8123")).toEqual({ kind: "shopify", shopifyCustomerId: "8123" });
    const key = customerKeyFor({ customerShopifyGid: null, customerEmail: "Jo+Test@Example.com" });
    expect(parseCustomerKey(key ?? "")).toEqual({ kind: "email", email: "jo+test@example.com" });
  });

  it.each(["", "x-1", "s-", "s-abc", "s-12a", "e-", "e-%E0%A4%A"])("rejects %j", (key) => {
    expect(parseCustomerKey(key)).toBeNull();
  });
});

describe("customerOrderWhere", () => {
  it("matches a Shopify customer by gid and a guest by case-insensitive email", () => {
    expect(customerOrderWhere({ kind: "shopify", shopifyCustomerId: "8123" })).toEqual({
      customerShopifyGid: "gid://shopify/Customer/8123",
    });
    expect(customerOrderWhere({ kind: "email", email: "a@b.co" })).toEqual({
      customerEmail: { equals: "a@b.co", mode: "insensitive" },
    });
  });
});
