import type { Route } from "./+types/production-artwork.$productionArtworkId.file";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { db } from "~/lib/db.server";
import { sanitizeDisplayFilename } from "~/domain/proofs/file-validation";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";

// Every production artwork file preview/download goes through this
// authenticated, authorization-checked resource route rather than a
// permanent public storage URL — the interim equivalent of a signed R2 URL
// (see ADR-0004), mirroring proof-assets.$assetId.tsx's precedent.
export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  if (!hasPermission(staffUser, "production_artwork.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const artwork = await db.productionArtwork.findFirst({
    where: { id: params.productionArtworkId, shopId: staffUser.shopId },
  });
  if (!artwork) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Production artwork not found", { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await storageAdapter.getObjectBuffer(artwork.storageKey);
  } catch {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("This production artwork file is unavailable in storage right now.", {
      status: 502,
    });
  }

  const displayName = sanitizeDisplayFilename(artwork.originalFilename);
  const disposition = artwork.isPreviewable ? "inline" : "attachment";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": artwork.mimeType,
      "Content-Disposition": `${disposition}; filename="${displayName}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
