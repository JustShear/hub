import type { ScanResult } from "@prisma/client";

/**
 * Pure scan validation (Milestone 16) — no DB access, so both the UI (to
 * show an immediate match/mismatch state) and the server action call the
 * exact same logic. `expectedValue: null` means there's nothing to validate
 * against (e.g. a Production task, which can span multiple order lines and
 * so has no single SKU) — the scan is still recorded, just informationally.
 */
export function validateScan(scannedValue: string, expectedValue: string | null): ScanResult {
  if (expectedValue === null) return "UNKNOWN";
  return scannedValue.trim() === expectedValue.trim() ? "MATCH" : "MISMATCH";
}
