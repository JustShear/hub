import type { Route } from "./+types/export-batches.$exportBatchId.package";
import { requireStaffUser } from "~/auth/staff-session.server";
import { hasPermission } from "~/auth/rbac";
import { storageAdapter } from "~/adapters/storage/get-storage-adapter.server";
import { recordExportPackageDownload } from "~/domain/production/record-export-package-download.server";

// Authenticated, authorization-checked download for a generated export
// package — mirrors proof-assets.$assetId.tsx's precedent. Records the
// download (informational count only, see
// record-export-package-download.server.ts) as part of serving the file;
// a prefetch or repeated GET could slightly over-count, which is accepted
// since nothing in the domain gates on this count being exact.
export async function loader({ request, params }: Route.LoaderArgs) {
  const staffUser = await requireStaffUser(request);
  if (!hasPermission(staffUser, "production_exports.download")) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("Forbidden", { status: 403 });
  }

  const recorded = await recordExportPackageDownload({
    shopId: staffUser.shopId,
    exportBatchId: params.exportBatchId,
    staffUserId: staffUser.id,
  });
  if (recorded.outcome === "rejected") {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response(recorded.reason, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await storageAdapter.getObjectBuffer(recorded.packageStorageKey);
  } catch {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Router's documented convention for triggering an ErrorBoundary
    throw new Response("This export package is unavailable in storage right now.", { status: 502 });
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="export-batch-${recorded.batchNumber}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
