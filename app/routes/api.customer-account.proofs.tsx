import type { Route } from "./+types/api.customer-account.proofs";
import { db } from "~/lib/db.server";
import {
  CUSTOMER_ACCOUNT_CORS_HEADERS,
  getCustomerAccountConfig,
} from "~/domain/customer-account/config.server";
import { verifyCustomerSessionToken } from "~/domain/customer-account/session-token.server";
import { loadAcceptedProofsForCustomerAccount } from "~/domain/customer-account/accepted-proofs.server";

// Public (no staff session) endpoint behind the customer's "My proofs" page
// in their Shopify account. Authorised ONLY by a verified Shopify session
// token; the customer comes from the token's signed `sub` claim, never from a
// query parameter, so one customer cannot ask for another's proofs.
function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { ...CUSTOMER_ACCOUNT_CORS_HEADERS, "Cache-Control": "no-store" },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  // React Router sends OPTIONS (the browser's CORS preflight) to the loader,
  // not the action - and a preflight carries no Authorization header, so it
  // must be answered before any auth check or the browser blocks the real
  // request.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CUSTOMER_ACCOUNT_CORS_HEADERS });
  }

  const config = getCustomerAccountConfig();
  if (!config) {
    return json({ error: "not_configured" }, 503);
  }

  const shop = await db.shop.findFirstOrThrow({ select: { id: true, shopifyDomain: true } });
  const verified = verifyCustomerSessionToken({
    authorizationHeader: request.headers.get("Authorization"),
    clientId: config.clientId,
    secret: config.secret,
    shopDomain: shop.shopifyDomain,
  });
  if (!verified.ok) {
    // The reason is logged for diagnosis, never returned (and never the
    // token itself) - a caller learns only that they were not authorised.
    console.warn(`Customer-account proofs request rejected: ${verified.reason}`);
    return json({ error: "unauthorized" }, 401);
  }

  const proofs = await loadAcceptedProofsForCustomerAccount({
    shopId: shop.id,
    customerId: verified.customerId,
    baseUrl: config.baseUrl,
    secret: config.secret,
  });
  return json({ proofs }, 200);
}

// The browser's CORS preflight (OPTIONS) is routed to `action`, as is any
// other non-GET method.
export function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CUSTOMER_ACCOUNT_CORS_HEADERS });
  }
  return json({ error: "method_not_allowed" }, 405);
}
