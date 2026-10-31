import type { Route } from "./+types/api.customer-account.proof-image.$assetId";
import { db } from "~/lib/db.server";
import { getCustomerAccountConfig } from "~/domain/customer-account/config.server";
import { verifyProofImageLink } from "~/domain/customer-account/signed-image-url.server";
import { findAcceptedProofAssetForCustomer } from "~/domain/customer-account/accepted-proofs.server";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";

// Serves one approved proof image to the customer it belongs to, via the
// signed link the proofs endpoint hands out. Every failure - bad signature,
// expired link, someone else's file, a file that does not exist - gets the
// same plain 404, so the route cannot be used to probe which asset ids exist.
function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const config = getCustomerAccountConfig();
  if (!config) {
    return notFound();
  }

  const link = verifyProofImageLink({
    assetId: params.assetId,
    searchParams: new URL(request.url).searchParams,
    secret: config.secret,
  });
  if (!link.ok) {
    return notFound();
  }

  const shop = await db.shop.findFirstOrThrow({ select: { id: true } });
  const asset = await findAcceptedProofAssetForCustomer({
    shopId: shop.id,
    customerId: link.customerId,
    assetId: params.assetId,
  });
  if (!asset || !(asset.mimeType ?? "").startsWith("image/")) {
    return notFound();
  }

  let buffer: Buffer;
  try {
    buffer = await storageAdapter.getObjectBuffer(asset.storageKey);
  } catch {
    return notFound();
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": asset.mimeType ?? "application/octet-stream",
      "Content-Length": String(buffer.length),
      "Content-Disposition": "inline",
      // Private: never cached by a shared proxy. A short browser cache is
      // fine - the link itself expires.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      // If someone opens an SVG directly rather than in an <img>, nothing in
      // it may run.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
