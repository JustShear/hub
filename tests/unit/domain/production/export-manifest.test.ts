import { describe, expect, it } from "vitest";
import {
  buildArchiveFilename,
  buildExportManifest,
  formatAustralianDateTime,
} from "~/domain/production/export-manifest";

describe("formatAustralianDateTime", () => {
  it("formats as DD/MM/YYYY HH:mm in UTC", () => {
    const date = new Date(Date.UTC(2026, 6, 29, 14, 5));
    expect(formatAustralianDateTime(date)).toBe("29/07/2026 14:05");
  });

  it("zero-pads single-digit day/month/hour/minute", () => {
    const date = new Date(Date.UTC(2026, 0, 5, 9, 3));
    expect(formatAustralianDateTime(date)).toBe("05/01/2026 09:03");
  });
});

describe("buildArchiveFilename", () => {
  it("produces a safe, flat artwork/ path with a sanitised group name", () => {
    const result = buildArchiveFilename({
      proofGroupName: "Front chest print",
      revisionNumber: 2,
      originalFilename: "artwork.pdf",
    });
    expect(result).toBe("artwork/Front_chest_print-rev2.pdf");
  });

  it("strips path separators from the group name so no traversal sequence can escape the artwork/ directory", () => {
    const result = buildArchiveFilename({
      proofGroupName: "../../etc/passwd",
      revisionNumber: 1,
      originalFilename: "file.pdf",
    });
    // A bare ".." with no path separator around it can't traverse
    // anywhere — the actual guarantee is that no `/` or `\` from the
    // group name survives past the fixed `artwork/` prefix.
    expect(result.slice("artwork/".length)).not.toMatch(/[/\\]/);
    expect(result.startsWith("artwork/")).toBe(true);
  });

  it("handles a filename with no extension", () => {
    const result = buildArchiveFilename({
      proofGroupName: "Cap embroidery",
      revisionNumber: 1,
      originalFilename: "noextension",
    });
    expect(result).toBe("artwork/Cap_embroidery-rev1");
  });
});

describe("buildExportManifest", () => {
  it("never includes customer mark-ups, raw payloads, tokens, or secrets — only the fields explicitly listed", () => {
    const manifest = buildExportManifest({
      shopName: "just-shear-dev.myshopify.com",
      orderNumber: "#9022",
      orderId: "order-1",
      batchNumber: 1,
      exportedAt: new Date(Date.UTC(2026, 6, 29, 10, 0)),
      exportedByStaffName: "Test Staff",
      isReexport: false,
      reexportReason: null,
      items: [
        {
          proofGroupId: "group-1",
          proofGroupName: "Jacket back logo",
          decorationMethod: "EMBROIDERY",
          placement: "Full back",
          approximateWidthMm: 200,
          approximateHeightMm: 150,
          sourceProofVersionNumber: 3,
          sourceNoProofReason: null,
          productionArtworkId: "artwork-1",
          productionArtworkRevisionNumber: 1,
          originalFilename: "jacket-logo.pdf",
          archiveFilename: "artwork/jacket-back-logo-rev1.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          checksum: "abc123",
          orderLineAllocations: [{ productLabel: "Varsity Jacket - Maroon / Large", quantity: 12 }],
        },
      ],
    });

    expect(manifest.generatedAt).toBe("29/07/2026 10:00");
    expect(manifest.batchNumber).toBe(1);
    expect(manifest.itemCount).toBe(1);
    expect(manifest.items[0]).toEqual({
      proofGroupName: "Jacket back logo",
      decorationMethod: "EMBROIDERY",
      placement: "Full back",
      dimensionsMm: "200mm x 150mm",
      source: "Approved proof version 3",
      productionArtworkRevision: 1,
      file: "artwork/jacket-back-logo-rev1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      checksumSha256: "abc123",
      orderLines: [{ productLabel: "Varsity Jacket - Maroon / Large", quantity: 12 }],
    });

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/rawPayload/i);
  });

  it("describes a no-proof-required item by its reason, not a version number", () => {
    const manifest = buildExportManifest({
      shopName: "shop",
      orderNumber: "#1",
      orderId: "order-1",
      batchNumber: 1,
      exportedAt: new Date(),
      exportedByStaffName: "Staff",
      isReexport: false,
      reexportReason: null,
      items: [
        {
          proofGroupId: "g1",
          proofGroupName: "Cap embroidery",
          decorationMethod: "EMBROIDERY",
          placement: "Front badge",
          approximateWidthMm: null,
          approximateHeightMm: null,
          sourceProofVersionNumber: null,
          sourceNoProofReason: "APPROVED_STANDARD_LOGO",
          productionArtworkId: "a1",
          productionArtworkRevisionNumber: 1,
          originalFilename: "cap.pdf",
          archiveFilename: "artwork/cap-embroidery-rev1.pdf",
          mimeType: "application/pdf",
          sizeBytes: 512,
          checksum: "def456",
          orderLineAllocations: [],
        },
      ],
    });
    expect(manifest.items[0]?.source).toBe("No proof required (APPROVED_STANDARD_LOGO)");
    expect(manifest.items[0]?.dimensionsMm).toBeNull();
  });
});
