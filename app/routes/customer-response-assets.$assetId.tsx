import type { Route } from "./+types/customer-response-assets.$assetId";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { db } from "~/lib/db.server";
import { sanitizeDisplayFilename } from "~/domain/proofs/file-validation";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";

// The staff-facing preview for a customer-supplied marked-up file — a
// separate route from proof-assets/:assetId (which serves ProofAsset, the
// internal proof file) so a customer mark-up is never reachable through the
// same URL shape as the original proof, keeping the two visually and
// structurally distinct end to end.
export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  if (!hasPermission(staffUser, "proof_responses.view")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const asset = await db.customerResponseAsset.findFirst({
    where: {
      id: params.assetId,
      response: { proofRequest: { shopId: staffUser.shopId } },
    },
  });
  if (!asset) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("File not found", { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await storageAdapter.getObjectBuffer(asset.storageKey);
  } catch {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("This file is unavailable in storage right now.", { status: 502 });
  }

  const displayName = sanitizeDisplayFilename(asset.originalFilename ?? "customer-upload");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": asset.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${displayName}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
