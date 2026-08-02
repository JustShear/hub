# ADR-0012: Barcode scan-to-fill (Milestone 16)

**Status:** Accepted.

## Context

`Barcode`/`ScanEvent` models and `BarcodeType`/`ScanResult` enums have existed in the schema since Milestone 02, reserved for later use, with zero references anywhere in the codebase until this milestone (technical-debt item 34). The Milestone 16 scoping decision (AskUserQuestion) was **scan-to-fill quantity entry**, not barcode generation/printing: a scanned value (keyboard-wedge scanner or camera-based scanner emitting keystrokes) fills the existing quantity-entry fields already built in Production (Milestone 11) and Warehouse (Milestone 13), rather than replacing those workflows.

## Decision

**Two genuinely different validation behaviours, not one shared rule**, because Warehouse and Production have structurally different data to validate against:

- **Warehouse** (`scanPickQuantity`, `app/domain/warehouse/scan-pick-quantity.server.ts`): a `WarehousePickItem` has exactly one SKU already snapshotted onto it. A scan is validated against that SKU via the pure `validateScan()` function (`app/domain/barcodes/validate-scan.ts`) — `MATCH` on trimmed equality, `MISMATCH` otherwise. On `MATCH`, the scan calls the existing `recordPickQuantity` with quantity 1, same as a manual entry would. On `MISMATCH`, the action is rejected unless the caller supplies an explicit override reason, which is itself recorded on the `ScanEvent` — mirroring this codebase's consistent "reasoned override" pattern (`ManualOverride`, `recordProductionQuantity`'s own over-quantity override, etc.) rather than inventing a new one.
- **Production** (`scanTaskQuantity`, `app/domain/production/scan-task-quantity.server.ts`): a `ProductionTask` has no single SKU — a proof group (and therefore a task) can span multiple order lines with different SKUs. There is nothing reliable to validate a scan against, so scanning here is **always informational, never blocking**: the `ScanEvent` is recorded with `expectedValue: null` (which `validateScan` reports as `UNKNOWN`, not `MATCH`/`MISMATCH`), and the scan always calls `recordProductionQuantity` with quantity 1 — a faster input method than typing, not a validation mechanism. Pretending a barcode can validate a decoration-method-level task would be dishonest about what the scan actually proves.

**`recordScanEvent` is a pure audit log, never a mutation trigger by itself.** `app/domain/barcodes/record-scan-event.server.ts` only ever writes one `ScanEvent` row; it never itself changes a quantity. Both `scanPickQuantity` and `scanTaskQuantity` call it and then separately call the existing, already-tested `recordPickQuantity`/`recordProductionQuantity` functions — scanning is a new *input path* into functions that already existed, not a new mutation path that duplicates their logic.

**No new permission.** Scanning reuses each domain's existing quantity-recording permission (`warehouse_picks.record_quantity`, `production_quantities.update`) — it's an input method for an already-gated action, not a new capability requiring its own grant.

**UI: a reusable, auto-focusable input, not a camera/scanner SDK.** `app/components/shared/BarcodeScanInput.tsx` is a plain text input that submits on Enter — the universal behaviour of both physical keyboard-wedge barcode scanners and most phone-camera scanning apps that type into the focused field. No camera-access API, no third-party scanning SDK was integrated; the input component doesn't know or care whether a human typed the value or a scanner did.

## Current limitations

- No real hardware (a physical barcode scanner or a barcode-generating step) was available to test against in this environment — verified via the same keyboard-input simulation any manual typed-quantity-entry test already uses, plus the `validateScan` pure-function unit tests and `scanPickQuantity`/`scanTaskQuantity` integration tests (MATCH/MISMATCH/override paths for Warehouse; the always-`UNKNOWN`/always-informational path for Production).
- Nothing in this codebase generates a barcode label to physically print and scan — `BarcodeType`/the `Barcode` model itself remain otherwise unused beyond backing `ScanEvent.relatedEntityType`/`relatedEntityId`'s conceptual link; there is no barcode-printing UI. Scan-to-fill assumes a barcode already exists on packaging/labels from an external source (e.g. the garment supplier's own SKU barcode), which was the scoping decision, not an oversight.

## Risks

Low. Every quantity-recording code path scan-to-fill calls into (`recordPickQuantity`, `recordProductionQuantity`) was already built, tested, and in production use since Milestones 11/13 — scanning adds a new way to populate their existing inputs, not new business logic inside them.

## Conditions that trigger reconsideration

- If a real barcode-printing/labeling workflow is ever built, `Barcode`'s remaining unused fields (beyond what `ScanEvent` already references) would need their first real reader.
- If Production ever gains a genuine single-SKU-per-task model (a real multi-step task decomposition, per technical-debt item 24), scan validation there could be tightened from purely informational to SKU-checked, matching Warehouse's model.

## Required future work

None identified this milestone — this closes technical-debt item 34 as originally scoped.
