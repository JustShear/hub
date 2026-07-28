// Detects likely-URL and likely-uploaded-file line properties without
// assuming a fixed OPTIS Product Options structure (SRS Section 11.4 — "must
// not assume how OPTIS stores data until real order payloads have been
// inspected"). Pure function: no DB, no network, fully unit-testable.
//
// `config` is the extension point for administrator-configurable mappings
// (SRS: "design the parser so administrator-configurable OPTIS mappings can
// be added later") — empty by default, since real mappings need real
// payloads to calibrate against (see docs/development.md "Known limitations").

export type DetectedPropertyType = "TEXT" | "SELECTION" | "URL" | "FILE_UPLOAD" | "UNKNOWN";

export interface RawLineProperty {
  key: string;
  value: string;
}

export interface ParsedLineProperty {
  name: string;
  value: string;
  sortOrder: number;
  detectedType: DetectedPropertyType;
  rawValue: RawLineProperty;
}

export interface OptisPropertyMappingConfig {
  /** Property names (case-insensitive) that should always be treated as file uploads once confirmed to be a URL. */
  knownFileUploadPropertyNames?: string[];
  /** Property names (case-insensitive) known to represent a fixed selection list rather than free text. */
  knownSelectionPropertyNames?: string[];
}

const FILE_EXTENSION_PATTERN = /\.(jpe?g|png|gif|webp|bmp|tiff?|svg|pdf|ai|eps|psd|zip)(\?|$)/i;

const UPLOAD_HOST_HINTS = [
  "cdn.shopify.com",
  "amazonaws.com",
  "s3.",
  "cloudinary.com",
  "/uploads/",
  "/upload/",
  "filestack",
  "widen.net",
];

function looksLikeUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function looksLikeFileUpload(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    FILE_EXTENSION_PATTERN.test(lower) || UPLOAD_HOST_HINTS.some((hint) => lower.includes(hint))
  );
}

export function parseOptisLineProperties(
  properties: RawLineProperty[],
  config: OptisPropertyMappingConfig = {},
): ParsedLineProperty[] {
  const knownFileUploadNames = new Set(
    (config.knownFileUploadPropertyNames ?? []).map((name) => name.toLowerCase()),
  );
  const knownSelectionNames = new Set(
    (config.knownSelectionPropertyNames ?? []).map((name) => name.toLowerCase()),
  );

  return properties.map((property, index) => {
    const trimmedValue = property.value.trim();
    const nameKey = property.key.toLowerCase();
    const isUrl = trimmedValue !== "" && looksLikeUrl(trimmedValue);
    const isFileUpload =
      isUrl && (looksLikeFileUpload(trimmedValue) || knownFileUploadNames.has(nameKey));

    let detectedType: DetectedPropertyType;
    if (!trimmedValue) {
      detectedType = "UNKNOWN";
    } else if (isFileUpload) {
      detectedType = "FILE_UPLOAD";
    } else if (isUrl) {
      // Confirmed to be a URL but not confidently an uploaded file — kept
      // distinct from FILE_UPLOAD rather than guessing either way.
      detectedType = "URL";
    } else if (knownSelectionNames.has(nameKey)) {
      detectedType = "SELECTION";
    } else {
      detectedType = "TEXT";
    }

    return {
      name: property.key,
      value: property.value,
      sortOrder: index,
      detectedType,
      rawValue: property,
    };
  });
}
