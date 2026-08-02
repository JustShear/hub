import { describe, expect, it } from "vitest";
import {
  buildStarshipitDestination,
  parseShippingAddress,
} from "~/domain/freight/parse-shipping-address";

const VALID_ADDRESS = {
  name: "Jordan Smith",
  address1: "123 Test Street",
  address2: "Unit 4",
  city: "Adelaide",
  provinceCode: "SA",
  zip: "5000",
  countryCodeV2: "AU",
  phone: "0400000000",
};

describe("parseShippingAddress", () => {
  it("returns null for a missing or non-object address", () => {
    expect(parseShippingAddress(null)).toBeNull();
    expect(parseShippingAddress(undefined)).toBeNull();
    expect(parseShippingAddress("not an object")).toBeNull();
  });

  it("returns null when every field is empty", () => {
    expect(parseShippingAddress({})).toBeNull();
  });

  it("parses a well-formed Shopify address", () => {
    const result = parseShippingAddress(VALID_ADDRESS);
    expect(result).toEqual(VALID_ADDRESS);
  });

  it("never crashes on non-string field values", () => {
    const result = parseShippingAddress({ name: 123, address1: "123 Test Street" });
    expect(result?.name).toBeNull();
    expect(result?.address1).toBe("123 Test Street");
  });
});

describe("buildStarshipitDestination", () => {
  it("rejects when there's no shipping address on file", () => {
    const result = buildStarshipitDestination(null, "Fallback Name");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no shipping address/i);
  });

  it("rejects when street, city, postcode, or country is missing", () => {
    const result = buildStarshipitDestination({ name: "Jordan Smith" }, null);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing/i);
  });

  it("builds a valid destination from a complete address", () => {
    const result = buildStarshipitDestination(VALID_ADDRESS, "Fallback Name");
    expect(result.valid).toBe(true);
    expect(result.destination).toEqual({
      name: "Jordan Smith",
      phone: "0400000000",
      street: "123 Test Street, Unit 4",
      suburb: null,
      city: "Adelaide",
      state: "SA",
      postCode: "5000",
      country: "AU",
      deliveryInstructions: null,
    });
  });

  it("falls back to the order's customer name when the address has none", () => {
    const result = buildStarshipitDestination({ ...VALID_ADDRESS, name: null }, "Fallback Name");
    expect(result.valid).toBe(true);
    expect(result.destination?.name).toBe("Fallback Name");
  });
});
