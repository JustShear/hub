import type { DecorationMethod, NoProofReason } from "@prisma/client";

// Pure manifest construction — no DB/storage access, so it's directly
// unit-testable. Dates are Australian format (DD/MM/YYYY) per the SRS;
// dimensions are metric (millimetres) — the only unit system this business
// uses, never inches/points.

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** DD/MM/YYYY HH:mm, always UTC — server timestamps are already UTC, and a
 * fixed zone keeps the manifest reproducible regardless of where it's
 * generated from. */
export function formatAustralianDateTime(date: Date): string {
  const day = pad2(date.getUTCDate());
  const month = pad2(date.getUTCMonth() + 1);
  const year = date.getUTCFullYear();
  const hours = pad2(date.getUTCHours());
  const minutes = pad2(date.getUTCMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export interface ExportManifestOrderLineAllocation {
  productLabel: string;
  quantity: number;
}

export interface ExportManifestItemInput {
  proofGroupId: string;
  proofGroupName: string;
  decorationMethod: DecorationMethod;
  placement: string | null;
  approximateWidthMm: number | null;
  approximateHeightMm: number | null;
  sourceProofVersionNumber: number | null;
  sourceNoProofReason: NoProofReason | null;
  productionArtworkId: string;
  productionArtworkRevisionNumber: number;
  originalFilename: string;
  archiveFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  orderLineAllocations: ExportManifestOrderLineAllocation[];
}

export interface ExportManifestInput {
  shopName: string;
  orderNumber: string;
  orderId: string;
  batchNumber: number;
  exportedAt: Date;
  exportedByStaffName: string;
  isReexport: boolean;
  reexportReason: string | null;
  items: ExportManifestItemInput[];
}

// A plain JSON-serialisable object — this exact shape is what gets stored
// verbatim as ExportBatch.manifestSnapshot and written as manifest.json
// inside the export package, so it must never contain anything excluded by
// the SRS (customer mark-ups, raw Shopify payloads, secure tokens, secrets).
export interface ExportManifest {
  generatedAt: string;
  shop: string;
  orderNumber: string;
  batchNumber: number;
  exportedBy: string;
  isReexport: boolean;
  reexportReason: string | null;
  itemCount: number;
  items: {
    proofGroupName: string;
    decorationMethod: string;
    placement: string | null;
    dimensionsMm: string | null;
    source: string;
    productionArtworkRevision: number;
    file: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    orderLines: ExportManifestOrderLineAllocation[];
  }[];
}

export function buildExportManifest(input: ExportManifestInput): ExportManifest {
  return {
    generatedAt: formatAustralianDateTime(input.exportedAt),
    shop: input.shopName,
    orderNumber: input.orderNumber,
    batchNumber: input.batchNumber,
    exportedBy: input.exportedByStaffName,
    isReexport: input.isReexport,
    reexportReason: input.reexportReason,
    itemCount: input.items.length,
    items: input.items.map((item) => ({
      proofGroupName: item.proofGroupName,
      decorationMethod: item.decorationMethod,
      placement: item.placement,
      dimensionsMm:
        item.approximateWidthMm != null && item.approximateHeightMm != null
          ? `${item.approximateWidthMm}mm x ${item.approximateHeightMm}mm`
          : null,
      source: item.sourceProofVersionNumber
        ? `Approved proof version ${item.sourceProofVersionNumber}`
        : `No proof required (${item.sourceNoProofReason ?? "reason not recorded"})`,
      productionArtworkRevision: item.productionArtworkRevisionNumber,
      file: item.archiveFilename,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      checksumSha256: item.checksum,
      orderLines: item.orderLineAllocations,
    })),
  };
}

const UNSAFE_ARCHIVE_FILENAME_CHARS = /[/\\<>:"|?*\- ]/g;

/**
 * A safe, collision-resistant filename for one item inside the ZIP package
 * — never the raw original filename alone (which could collide across
 * groups, or contain path-traversal sequences). Always inside a flat
 * `artwork/` directory; yazl never interprets `..` specially, but this
 * still guarantees no path separator survives into the archive entry name.
 */
export function buildArchiveFilename(params: {
  proofGroupName: string;
  revisionNumber: number;
  originalFilename: string;
}): string {
  const extension = params.originalFilename.includes(".")
    ? params.originalFilename.slice(params.originalFilename.lastIndexOf("."))
    : "";
  const safeExtension = extension.replace(UNSAFE_ARCHIVE_FILENAME_CHARS, "");
  const safeGroupName = params.proofGroupName
    .replace(UNSAFE_ARCHIVE_FILENAME_CHARS, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
  return `artwork/${safeGroupName || "group"}-rev${params.revisionNumber}${safeExtension}`;
}
