import { sanitizeDisplayFilename } from "~/domain/proofs/file-validation";

// Pure production-artwork file validation — no filesystem or database
// access. Production files are a different trust boundary from proof files
// (app/domain/proofs/file-validation.ts): they're prepared by staff for a
// print/embroidery vendor, not reviewed by a customer, so the accepted kind
// list is much wider and several of them (EPS/AI/EMB) can never be rendered
// inline in a browser.

export const MAX_PRODUCTION_ARTWORK_FILE_BYTES = 100 * 1024 * 1024; // 100MB — production files (large TIFFs, multi-colour embroidery digitising) run bigger than a customer-facing proof image.

export type ProductionArtworkFileKind = "pdf" | "png" | "tiff" | "svg" | "eps" | "ai" | "emb";

export const PRODUCTION_ARTWORK_KIND_MIME_TYPES: Record<ProductionArtworkFileKind, string> = {
  pdf: "application/pdf",
  png: "image/png",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  eps: "application/postscript",
  ai: "application/postscript",
  emb: "application/octet-stream",
};

export const PRODUCTION_ARTWORK_KIND_EXTENSIONS: Record<ProductionArtworkFileKind, string> = {
  pdf: "pdf",
  png: "png",
  tiff: "tif",
  svg: "svg",
  eps: "eps",
  ai: "ai",
  emb: "emb",
};

// A file can be shown inline (an <img>/<object> preview) versus one that can
// only ever be offered as a download for opening in dedicated design or
// digitising software. Never used to reject a file — only to decide how the
// UI offers it.
export const PRODUCTION_ARTWORK_PREVIEWABLE_KINDS: ReadonlySet<ProductionArtworkFileKind> = new Set(
  ["pdf", "png", "svg"],
);

export function isPreviewableProductionArtworkKind(kind: ProductionArtworkFileKind): boolean {
  return PRODUCTION_ARTWORK_PREVIEWABLE_KINDS.has(kind);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_SIGNATURE = Buffer.from("%PDF", "ascii");
const PS_SIGNATURE = Buffer.from("%!PS-Adobe", "ascii");
const TIFF_LE_SIGNATURE = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE_SIGNATURE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);
const EPS_BINARY_HEADER = Buffer.from([0xc5, 0xd0, 0xd3, 0xc6]);

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return (
    buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)
  );
}

// SVG has no binary magic bytes — it's plain (or BOM-prefixed) XML. Scan a
// bounded prefix for the `<svg` tag rather than trusting the extension
// alone; still rejects anything that isn't recognisably SVG markup.
const SVG_SCAN_WINDOW_BYTES = 4096;

function looksLikeSvg(buffer: Buffer): boolean {
  const prefix = buffer
    .subarray(0, Math.min(buffer.length, SVG_SCAN_WINDOW_BYTES))
    .toString("utf8");
  return /<svg[\s>]/i.test(prefix);
}

// Modern Illustrator files are PDF-compatible containers; legacy ones are
// plain PostScript. Both embed an "Adobe Illustrator" creator comment near
// the top of the file — that comment, not the outer container format, is
// what distinguishes an .ai file from a plain .pdf/.eps.
const CREATOR_SCAN_WINDOW_BYTES = 8192;

function looksLikeIllustrator(buffer: Buffer): boolean {
  const prefix = buffer
    .subarray(0, Math.min(buffer.length, CREATOR_SCAN_WINDOW_BYTES))
    .toString("latin1");
  return /Adobe Illustrator|AIPrivateData/i.test(prefix);
}

/**
 * Detects a file's real kind from its magic bytes/content wherever a
 * reliable signature exists (PDF, PNG, TIFF, SVG, EPS, AI). Embroidery
 * digitising formats loosely grouped under "EMB" span many proprietary,
 * undocumented vendor encodings with no single reliable public signature —
 * for that one kind only, the caller-declared extension is trusted instead
 * of a magic-byte check (see `detectProductionArtworkKind`'s `declaredKind`
 * parameter). This is a deliberate, documented exception, not an oversight:
 * rejecting a legitimate embroidery file because it can't be signature-
 * verified would violate the requirement to never reject a legitimate
 * unpreviewable format.
 */
export function detectProductionArtworkSignature(
  buffer: Buffer,
): Exclude<ProductionArtworkFileKind, "emb"> | null {
  if (startsWith(buffer, PNG_SIGNATURE)) return "png";
  if (startsWith(buffer, TIFF_LE_SIGNATURE) || startsWith(buffer, TIFF_BE_SIGNATURE)) return "tiff";
  if (startsWith(buffer, PDF_SIGNATURE)) return looksLikeIllustrator(buffer) ? "ai" : "pdf";
  if (startsWith(buffer, PS_SIGNATURE) || startsWith(buffer, EPS_BINARY_HEADER)) {
    return looksLikeIllustrator(buffer) ? "ai" : "eps";
  }
  if (looksLikeSvg(buffer)) return "svg";
  return null;
}

export type ProductionArtworkValidationResult =
  | { valid: true; kind: ProductionArtworkFileKind; mimeType: string; isPreviewable: boolean }
  | { valid: false; reason: string };

/**
 * `declaredExtension` (from the uploaded filename, lower-cased, no dot) is
 * only consulted for the one kind (.emb) that has no reliable signature —
 * every other kind is verified from file content regardless of what the
 * filename or browser-supplied MIME type claims.
 */
export function validateProductionArtworkFile(
  buffer: Buffer,
  declaredExtension: string,
): ProductionArtworkValidationResult {
  if (buffer.length === 0) {
    return { valid: false, reason: "The uploaded file is empty." };
  }
  if (buffer.length > MAX_PRODUCTION_ARTWORK_FILE_BYTES) {
    return {
      valid: false,
      reason: `Production artwork files can't be larger than ${MAX_PRODUCTION_ARTWORK_FILE_BYTES / (1024 * 1024)}MB.`,
    };
  }

  const signatureKind = detectProductionArtworkSignature(buffer);
  if (signatureKind) {
    return {
      valid: true,
      kind: signatureKind,
      mimeType: PRODUCTION_ARTWORK_KIND_MIME_TYPES[signatureKind],
      isPreviewable: isPreviewableProductionArtworkKind(signatureKind),
    };
  }

  if (declaredExtension.toLowerCase() === "emb") {
    return {
      valid: true,
      kind: "emb",
      mimeType: PRODUCTION_ARTWORK_KIND_MIME_TYPES.emb,
      isPreviewable: false,
    };
  }

  return {
    valid: false,
    reason:
      "Unsupported file type. Accepted production artwork formats are PDF, PNG, TIFF, SVG, EPS, AI, and EMB.",
  };
}

export { sanitizeDisplayFilename };
