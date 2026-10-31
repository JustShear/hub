import { createHash, timingSafeEqual } from "node:crypto";
import type { Route } from "./+types/api.storefront.customer-proofs";
import { env } from "~/lib/env.server";
import { db } from "~/lib/db.server";
import { getCustomerAccountConfig } from "~/domain/customer-account/config.server";
import { loadAcceptedProofsForCustomerAccount } from "~/domain/customer-account/accepted-proofs.server";

// Server-to-server endpoint for the product options app: "which approved
// proofs does this logged-in customer have?" - used to offer them as one-click
// choices when the customer reorders. There is no staff or customer session
// here; the caller proves itself with a shared secret, and it is the CALLER's
// job to pass only a customer id Shopify has vouched for (the options app
// reads it from a signature-verified app-proxy request). Every image link in
// the answer is the same short-lived, customer-bound signed link the account
// page uses, so a leaked list can't be used to reach anyone else's artwork.
function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function keysMatch(provided: string, expected: string): boolean {
  // Hash both sides first so the comparison is constant-time AND length-safe.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function loader({ request }: Route.LoaderArgs) {
  const apiKey = env.STOREFRONT_API_KEY;
  const config = getCustomerAccountConfig();
  if (!apiKey || !config) {
    return json({ error: "not_configured" }, 503);
  }

  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization")?.trim() ?? "")?.[1];
  if (!bearer || !keysMatch(bearer, apiKey)) {
    return json({ error: "unauthorized" }, 401);
  }

  const customerId = new URL(request.url).searchParams.get("customerId") ?? "";
  if (!/^\d{1,20}$/.test(customerId)) {
    return json({ error: "invalid_customer" }, 400);
  }

  const shop = await db.shop.findFirstOrThrow({ select: { id: true } });
  const proofs = await loadAcceptedProofsForCustomerAccount({
    shopId: shop.id,
    customerId,
    baseUrl: config.baseUrl,
    secret: config.secret,
  });
  return json({ proofs }, 200);
}
