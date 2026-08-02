import type { Route } from "./+types/freight-shipments.$freightShipmentId.label";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";
import { recordFreightLabelDownload } from "~/domain/freight/record-freight-label-download.server";

// Authenticated, authorization-checked download for a generated freight
// label PDF — mirrors export-batches.$exportBatchId.package.tsx's precedent
// exactly. Records the download (informational count only) as part of
// serving the file.
export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  if (!hasPermission(staffUser, "freight_shipments.download")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const recorded = await recordFreightLabelDownload({
    shopId: staffUser.shopId,
    freightShipmentId: params.freightShipmentId,
    staffUserId: staffUser.id,
  });
  if (recorded.outcome === "rejected") {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response(recorded.reason, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await storageAdapter.getObjectBuffer(recorded.labelStorageKey);
  } catch {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("This freight label is unavailable in storage right now.", { status: 502 });
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="freight-label-${params.freightShipmentId}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
