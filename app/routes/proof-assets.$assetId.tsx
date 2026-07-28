import type { Route } from "./+types/proof-assets.$assetId";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { db } from "~/lib/db.server";
import { sanitizeDisplayFilename } from "~/domain/proofs/file-validation";
import { localDiskStorageAdapter } from "~/adapters/storage/local-disk-storage.server";

// Every proof-file preview/download goes through this authenticated,
// authorization-checked resource route rather than a permanent public
// storage URL — the interim equivalent of a signed R2 URL (see ADR-0004).
// Scoped to the requesting staff member's own shop; never trusts the raw
// asset id alone.
export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  if (!hasPermission(staffUser, "proof_versions.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const asset = await db.proofAsset.findFirst({
    where: {
      id: params.assetId,
      proofVersion: { proofGroup: { order: { shopId: staffUser.shopId } } },
    },
  });
  if (!asset) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Proof file not found", { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await localDiskStorageAdapter.getObjectBuffer(asset.storageKey);
  } catch {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("This proof file is unavailable in storage right now.", { status: 502 });
  }

  const displayName = sanitizeDisplayFilename(asset.originalFilename ?? "proof-file");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": asset.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${displayName}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
