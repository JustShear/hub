import { describe, expect, it } from "vitest";
import {
  detectFileSignature,
  MAX_PROOF_FILE_BYTES,
  sanitizeDisplayFilename,
  validateProofFile,
} from "~/domain/proofs/file-validation";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "utf8");
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("detectFileSignature", () => {
  it("detects PNG from magic bytes", () => {
    expect(detectFileSignature(PNG_BYTES)).toBe("png");
  });

  it("detects JPEG from magic bytes", () => {
    expect(detectFileSignature(JPEG_BYTES)).toBe("jpeg");
  });

  it("detects PDF from magic bytes", () => {
    expect(detectFileSignature(PDF_BYTES)).toBe("pdf");
  });

  it("returns null for an unrecognised file, even with a misleading extension", () => {
    const fakeExecutable = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // "MZ" — Windows executable header
    expect(detectFileSignature(fakeExecutable)).toBeNull();
  });

  it("returns null for a plain-text file that merely claims to be an image", () => {
    const textMasqueradingAsImage = Buffer.from("this is not really a png", "utf8");
    expect(detectFileSignature(textMasqueradingAsImage)).toBeNull();
  });
});

describe("validateProofFile", () => {
  it("accepts a valid PNG", () => {
    const result = validateProofFile(PNG_BYTES);
    expect(result).toMatchObject({ valid: true, kind: "png", mimeType: "image/png" });
  });

  it("accepts a valid PDF", () => {
    const result = validateProofFile(PDF_BYTES);
    expect(result).toMatchObject({ valid: true, kind: "pdf", mimeType: "application/pdf" });
  });

  it("rejects an empty file", () => {
    const result = validateProofFile(Buffer.alloc(0));
    expect(result).toMatchObject({ valid: false });
  });

  it("rejects a file over the maximum size", () => {
    const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_PROOF_FILE_BYTES)]);
    const result = validateProofFile(oversized);
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reason).toMatch(/25MB/);
    }
  });

  it("rejects an unsupported file type", () => {
    const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    const result = validateProofFile(executable);
    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.reason).toMatch(/Unsupported file type/);
    }
  });

  it("never trusts a declared MIME type alone — only the file's own bytes decide its kind", () => {
    // A plain-text buffer, however it might be labelled by a browser's `file.type`.
    const disguised = Buffer.from("plain text pretending to be a proof file", "utf8");
    const result = validateProofFile(disguised);
    expect(result.valid).toBe(false);
  });
});

describe("sanitizeDisplayFilename", () => {
  it("leaves an ordinary filename untouched", () => {
    expect(sanitizeDisplayFilename("left-chest-v2.png")).toBe("left-chest-v2.png");
  });

  it("strips path separators", () => {
    expect(sanitizeDisplayFilename("../../etc/passwd")).not.toContain("/");
  });

  it("strips control characters but preserves ordinary spaces", () => {
    const withControlChar = `logo${String.fromCharCode(7)}final.png`;
    expect(sanitizeDisplayFilename(withControlChar)).not.toContain(String.fromCharCode(7));
    expect(sanitizeDisplayFilename("final logo.png")).toBe("final logo.png");
  });

  it("falls back to 'untitled' for an empty or whitespace-only name", () => {
    expect(sanitizeDisplayFilename("   ")).toBe("untitled");
  });

  it("caps extremely long filenames", () => {
    const long = "a".repeat(500) + ".png";
    expect(sanitizeDisplayFilename(long).length).toBeLessThanOrEqual(200);
  });
});
