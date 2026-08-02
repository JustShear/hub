import type { StarshipitDestination } from "~/adapters/starshipit/starshipit-client.server";

// ShopifyOrder.shippingAddress is stored as opaque Json (ADR-0003) — this
// reads the known Shopify GraphQL address shape defensively, the same
// convention as app/components/order-drawer/AddressBlock.tsx's parseAddress,
// without normalising the underlying schema.
export interface ParsedShippingAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  zip: string | null;
  countryCodeV2: string | null;
  phone: string | null;
}

export function parseShippingAddress(value: unknown): ParsedShippingAddress | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const asString = (key: string): string | null =>
    typeof record[key] === "string" ? record[key] : null;
  const parsed: ParsedShippingAddress = {
    name: asString("name"),
    address1: asString("address1"),
    address2: asString("address2"),
    city: asString("city"),
    provinceCode: asString("provinceCode"),
    zip: asString("zip"),
    countryCodeV2: asString("countryCodeV2"),
    phone: asString("phone"),
  };
  const fields: (string | null)[] = [
    parsed.name,
    parsed.address1,
    parsed.address2,
    parsed.city,
    parsed.provinceCode,
    parsed.zip,
    parsed.countryCodeV2,
    parsed.phone,
  ];
  const hasAnyField = fields.some((field) => field !== null && field.trim().length > 0);
  return hasAnyField ? parsed : null;
}

export interface BuildStarshipitDestinationResult {
  valid: boolean;
  reason?: string;
  destination?: StarshipitDestination;
}

/** A shipment can't be created without at least a name, street, city, postcode, and country. */
export function buildStarshipitDestination(
  shippingAddress: unknown,
  customerName: string | null,
): BuildStarshipitDestinationResult {
  const parsed = parseShippingAddress(shippingAddress);
  if (!parsed) {
    return { valid: false, reason: "This order has no shipping address on file." };
  }
  if (!parsed.address1 || !parsed.city || !parsed.zip || !parsed.countryCodeV2) {
    return {
      valid: false,
      reason: "This order's shipping address is missing a street, city, postcode, or country.",
    };
  }
  return {
    valid: true,
    destination: {
      name: parsed.name ?? customerName ?? "Customer",
      phone: parsed.phone,
      street: parsed.address2 ? `${parsed.address1}, ${parsed.address2}` : parsed.address1,
      suburb: null,
      city: parsed.city,
      state: parsed.provinceCode,
      postCode: parsed.zip,
      country: parsed.countryCodeV2,
      deliveryInstructions: null,
    },
  };
}
