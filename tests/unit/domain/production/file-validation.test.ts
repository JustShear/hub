import { describe, expect, it } from "vitest";
import {
  MAX_PRODUCTION_ARTWORK_FILE_BYTES,
  detectProductionArtworkSignature,
  validateProductionArtworkFile,
} from "~/domain/production/file-validation";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "utf8");
const TIFF_LE_BYTES = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");
const EPS_BYTES = Buffer.from("%!PS-Adobe-3.0 EPSF-3.0\n", "utf8");
const AI_PDF_BYTES = Buffer.from(
  "%PDF-1.5\n%%Creator: Adobe Illustrator(R) 27.0\n%%AIPrivateData\n",
  "utf8",
);

describe("detectProductionArtworkSignature", () => {
  it("detects PNG", () => {
    expect(detectProductionArtworkSignature(PNG_BYTES)).toBe("png");
  });
  it("detects PDF", () => {
    expect(detectProductionArtworkSignature(PDF_BYTES)).toBe("pdf");
  });
  it("detects TIFF (little-endian)", () => {
    expect(detectProductionArtworkSignature(TIFF_LE_BYTES)).toBe("tiff");
  });
  it("detects SVG from markup, not extension", () => {
    expect(detectProductionArtworkSignature(SVG_BYTES)).toBe("svg");
  });
  it("detects EPS", () => {
    expect(detectProductionArtworkSignature(EPS_BYTES)).toBe("eps");
  });
  it("detects AI when a PDF container has an Illustrator creator comment", () => {
    expect(detectProductionArtworkSignature(AI_PDF_BYTES)).toBe("ai");
  });
  it("returns null for unrecognisable content", () => {
    expect(detectProductionArtworkSignature(Buffer.from("just some text"))).toBeNull();
  });
});

describe("validateProductionArtworkFile", () => {
  it("accepts a PNG regardless of declared extension", () => {
    const result = validateProductionArtworkFile(PNG_BYTES, "png");
    expect(result).toEqual({
      valid: true,
      kind: "png",
      mimeType: "image/png",
      isPreviewable: true,
    });
  });

  it("accepts EMB by trusting the declared extension — no reliable signature exists", () => {
    const result = validateProductionArtworkFile(Buffer.from([0x01, 0x02, 0x03, 0x04]), "emb");
    expect(result).toEqual({
      valid: true,
      kind: "emb",
      mimeType: "application/octet-stream",
      isPreviewable: false,
    });
  });

  it("rejects an empty file", () => {
    const result = validateProductionArtworkFile(Buffer.alloc(0), "pdf");
    expect(result).toEqual({ valid: false, reason: "The uploaded file is empty." });
  });

  it("rejects a file over the size limit", () => {
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_PRODUCTION_ARTWORK_FILE_BYTES)]);
    const result = validateProductionArtworkFile(big, "pdf");
    expect(result.valid).toBe(false);
  });

  it("rejects unrecognisable content declared as a non-EMB extension", () => {
    const result = validateProductionArtworkFile(Buffer.from("nonsense"), "docx");
    expect(result.valid).toBe(false);
  });

  it("never trusts a declared .emb extension to override a real signature match", () => {
    // A genuine PNG mislabelled as .emb should still be detected as PNG by
    // content, not blindly accepted as an opaque embroidery file.
    const result = validateProductionArtworkFile(PNG_BYTES, "emb");
    expect(result).toEqual({
      valid: true,
      kind: "png",
      mimeType: "image/png",
      isPreviewable: true,
    });
  });

  it("classifies TIFF and EPS/AI as not previewable", () => {
    expect(validateProductionArtworkFile(TIFF_LE_BYTES, "tif")).toMatchObject({
      isPreviewable: false,
    });
    expect(validateProductionArtworkFile(EPS_BYTES, "eps")).toMatchObject({ isPreviewable: false });
  });

  it("classifies SVG as previewable", () => {
    expect(validateProductionArtworkFile(SVG_BYTES, "svg")).toMatchObject({ isPreviewable: true });
  });
});
