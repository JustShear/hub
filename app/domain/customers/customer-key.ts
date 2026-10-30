// A "customer" in the Hub is not its own table — Shopify owns customers, and
// the Hub only ever stores the customer fields copied onto each order. So a
// customer is identified by whichever stable identifier the order carries:
// the Shopify customer id when there is one, otherwise (guest checkout) the
// email address. The key lives in a URL, so it is a short prefixed string.

export type CustomerIdentity =
  { kind: "shopify"; shopifyCustomerId: string } | { kind: "email"; email: string };

export interface CustomerKeySource {
  customerShopifyGid: string | null;
  customerEmail: string | null;
}

/** "gid://shopify/Customer/123" -> "123". Null for anything unrecognisable. */
function shopifyCustomerIdFromGid(gid: string): string | null {
  const match = /^gid:\/\/shopify\/Customer\/(\d+)$/.exec(gid);
  return match?.[1] ?? null;
}

export function customerKeyFor(source: CustomerKeySource): string | null {
  if (source.customerShopifyGid) {
    const id = shopifyCustomerIdFromGid(source.customerShopifyGid);
    if (id) {
      return `s-${id}`;
    }
  }
  const email = source.customerEmail?.trim().toLowerCase();
  if (email) {
    return `e-${encodeURIComponent(email)}`;
  }
  return null;
}

export function parseCustomerKey(key: string): CustomerIdentity | null {
  if (key.startsWith("s-")) {
    const id = key.slice(2);
    return /^\d+$/.test(id) ? { kind: "shopify", shopifyCustomerId: id } : null;
  }
  if (key.startsWith("e-")) {
    try {
      const email = decodeURIComponent(key.slice(2)).trim().toLowerCase();
      return email ? { kind: "email", email } : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Prisma `where` fragment selecting every order that belongs to this customer. */
export function customerOrderWhere(identity: CustomerIdentity) {
  return identity.kind === "shopify"
    ? { customerShopifyGid: `gid://shopify/Customer/${identity.shopifyCustomerId}` }
    : { customerEmail: { equals: identity.email, mode: "insensitive" as const } };
}
