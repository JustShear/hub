// Pure proof-file validation logic — no filesystem or database access, so
// it's directly unit-testable and safe to call before anything is written
// to storage. Never trusts the browser-supplied MIME type or filename
// alone: the file's own magic bytes are what determine its accepted kind.

export const MAX_PROOF_FILE_BYTES = 25 * 1024 * 1024; // 25MB, per the architecture review's own recommendation

export type ProofFileKind = "png" | "jpeg" | "pdf";

export const PROOF_FILE_KIND_MIME_TYPES: Record<ProofFileKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
};

export const PROOF_FILE_KIND_EXTENSIONS: Record<ProofFileKind, string> = {
  png: "png",
  jpeg: "jpg",
  pdf: "pdf",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_SIGNATURE = Buffer.from("%PDF", "ascii");

/**
 * Detects a file's real kind from its magic bytes — the only thing this
 * validator trusts. Returns null for anything else, including files that
 * merely claim (via extension or browser-supplied `type`) to be one of the
 * accepted kinds without the matching signature.
 */
export function detectFileSignature(buffer: Buffer): ProofFileKind | null {
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return "png";
  }
  if (
    buffer.length >= JPEG_SIGNATURE.length &&
    buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  ) {
    return "jpeg";
  }
  if (
    buffer.length >= PDF_SIGNATURE.length &&
    buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)
  ) {
    return "pdf";
  }
  return null;
}

export type ProofFileValidationResult =
  { valid: true; kind: ProofFileKind; mimeType: string } | { valid: false; reason: string };

export function validateProofFile(buffer: Buffer): ProofFileValidationResult {
  if (buffer.length === 0) {
    return { valid: false, reason: "The uploaded file is empty." };
  }
  if (buffer.length > MAX_PROOF_FILE_BYTES) {
    return {
      valid: false,
      reason: `Proof files can't be larger than ${MAX_PROOF_FILE_BYTES / (1024 * 1024)}MB.`,
    };
  }
  const kind = detectFileSignature(buffer);
  if (!kind) {
    return {
      valid: false,
      reason: "Unsupported file type. Only PDF, PNG, and JPEG proof files are accepted.",
    };
  }
  return { valid: true, kind, mimeType: PROOF_FILE_KIND_MIME_TYPES[kind] };
}

const CONTROL_CHAR_START = 0x00;
const CONTROL_CHAR_END = 0x1f;

function isUnsafeFilenameChar(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code >= CONTROL_CHAR_START && code <= CONTROL_CHAR_END) return true;
  return char === "/" || char === "\\" || char === "<" || char === ">";
}

const MAX_DISPLAY_FILENAME_LENGTH = 200;

/**
 * Strips path separators, angle brackets, and control characters before
 * ever displaying a filename back to staff. This is display sanitisation
 * only — the filename is never used to construct a storage path (storage
 * keys are always server-generated, see create-proof-version.server.ts),
 * so it doesn't need to be filesystem-safe, only safe to render.
 */
export function sanitizeDisplayFilename(originalFilename: string): string {
  const sanitized = Array.from(originalFilename)
    .map((char) => (isUnsafeFilenameChar(char) ? "_" : char))
    .join("")
    .trim();
  const safe = sanitized.length > 0 ? sanitized : "untitled";
  return safe.length > MAX_DISPLAY_FILENAME_LENGTH
    ? safe.slice(0, MAX_DISPLAY_FILENAME_LENGTH)
    : safe;
}
