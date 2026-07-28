import { describe, expect, it } from "vitest";
import { parseOptisLineProperties } from "~/domain/orders/optis-property-parser";

describe("parseOptisLineProperties", () => {
  it("detects plain text as TEXT", () => {
    const [result] = parseOptisLineProperties([{ key: "Personalisation", value: "John Smith" }]);
    expect(result?.detectedType).toBe("TEXT");
  });

  it("detects a Shopify CDN image URL as FILE_UPLOAD", () => {
    const [result] = parseOptisLineProperties([
      { key: "Logo Upload", value: "https://cdn.shopify.com/s/files/1/0001/logo.png" },
    ]);
    expect(result?.detectedType).toBe("FILE_UPLOAD");
  });

  it("detects a URL with a recognised file extension as FILE_UPLOAD even off a non-CDN host", () => {
    const [result] = parseOptisLineProperties([
      { key: "Artwork", value: "https://example-optis-host.com/files/artwork-final.pdf" },
    ]);
    expect(result?.detectedType).toBe("FILE_UPLOAD");
  });

  it("detects a plain URL with no file-like signal as URL, not FILE_UPLOAD", () => {
    const [result] = parseOptisLineProperties([
      { key: "Reference link", value: "https://example.com/some/page" },
    ]);
    expect(result?.detectedType).toBe("URL");
  });

  it("treats an empty value as UNKNOWN", () => {
    const [result] = parseOptisLineProperties([{ key: "Notes", value: "   " }]);
    expect(result?.detectedType).toBe("UNKNOWN");
  });

  it("uses knownSelectionPropertyNames to mark a configured property as SELECTION", () => {
    const [result] = parseOptisLineProperties([{ key: "Size", value: "Large" }], {
      knownSelectionPropertyNames: ["size"],
    });
    expect(result?.detectedType).toBe("SELECTION");
  });

  it("matches configured selection names case-insensitively", () => {
    const [result] = parseOptisLineProperties([{ key: "COLOUR", value: "Navy" }], {
      knownSelectionPropertyNames: ["colour"],
    });
    expect(result?.detectedType).toBe("SELECTION");
  });

  it("uses knownFileUploadPropertyNames to upgrade a URL that lacks file signals to FILE_UPLOAD", () => {
    const [result] = parseOptisLineProperties(
      [{ key: "Custom Upload", value: "https://example-host.com/asset/abc123" }],
      { knownFileUploadPropertyNames: ["custom upload"] },
    );
    expect(result?.detectedType).toBe("FILE_UPLOAD");
  });

  it("does not let a known-file-upload name override plain text into a file", () => {
    const [result] = parseOptisLineProperties(
      [{ key: "Custom Upload", value: "not a url at all" }],
      { knownFileUploadPropertyNames: ["custom upload"] },
    );
    expect(result?.detectedType).toBe("TEXT");
  });

  it("preserves original ordering via sortOrder and keeps every property", () => {
    const results = parseOptisLineProperties([
      { key: "First", value: "1" },
      { key: "Second", value: "2" },
      { key: "Third", value: "3" },
    ]);
    expect(results.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
    expect(results.map((r) => r.name)).toEqual(["First", "Second", "Third"]);
  });

  it("preserves the raw {key, value} pair verbatim", () => {
    const [result] = parseOptisLineProperties([
      { key: "Logo Upload", value: "https://cdn.shopify.com/s/files/1/logo.png" },
    ]);
    expect(result?.rawValue).toEqual({
      key: "Logo Upload",
      value: "https://cdn.shopify.com/s/files/1/logo.png",
    });
  });

  it("handles several properties on the same line independently", () => {
    const results = parseOptisLineProperties([
      { key: "Name", value: "Jane" },
      { key: "Logo", value: "https://cdn.shopify.com/s/files/1/a.png" },
      { key: "Notes", value: "" },
    ]);
    expect(results.map((r) => r.detectedType)).toEqual(["TEXT", "FILE_UPLOAD", "UNKNOWN"]);
  });
});
