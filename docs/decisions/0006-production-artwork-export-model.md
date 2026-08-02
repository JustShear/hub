# ADR-0006: Replace the placeholder `ProductionExport` model with `ProductionArtwork` + `ExportBatch`

**Status:** Accepted.

## Context

The original architecture review reserved a single placeholder model, `ProductionExport`, for the eventual print-export handover: `proofGroupId`, a **required** `proofVersionId`, `exportedByStaffId`, `destination`, `productionFileStorageKey`, `internalNote`, `isOverride`/`overrideReason`, `exportedAt`. It was created early (Milestone 02's full-schema pass) purely to reserve the shape, and was never referenced by any application code through Milestones 03-09 — confirmed via `grep -rn "ProductionExport|productionExport" app/` returning zero hits, and via a direct row-count check showing zero rows in every environment.

Milestone 10 ("Export for Print and Production Artwork") requires more than that placeholder can express:

- A proof group can become export-eligible two ways — an approved `ProofVersion`, or a documented `NO_PROOF_REQUIRED` decision with no version at all. The placeholder's `proofVersionId` was required, so it structurally cannot represent the second path.
- Production artwork is its own uploaded, versioned, validated artefact — separate from the proof file, separate from customer mark-ups, never overwritten, every revision preserved. The placeholder had no revision concept, no validation state, and no distinction between "the file staff prepared for production" and "the file used to prove the design."
- An export is a batch, staff-facing, dedicated, audited action across one or more groups on an order at once, producing an immutable package (manifest + files) that must never be silently regenerated, and must support re-export with a reason when something changes after the fact. The placeholder was a single flat row per export with no package, no manifest, no batch grouping, and no re-export lineage.

## Decision

Drop `ProductionExport` entirely (safe: zero rows, zero references) and replace it with four models:

- **`ProductionArtwork`** — the production-ready file itself. `sourceProofVersionId` (nullable) and `sourceNoProofReasonSnapshot` (nullable `NoProofReason`) together represent either eligibility path without forcing one to be present; `revisionNumber` (`@@unique([proofGroupId, revisionNumber])`, using the same read-latest-inside-transaction-plus-unique-retry pattern as `ProofVersion.versionNumber` from Milestone 08) preserves every prior revision rather than overwriting; `status` (`ProductionArtworkStatus`: `DRAFT/VALIDATION_FAILED/READY_FOR_EXPORT/EXPORTED/SUPERSEDED/CANCELLED`) tracks its own lifecycle independently of the proof group's; `supersededByArtworkId` (self-relation) links a revision to whatever replaced it without deleting it. The long list of requested production metadata (print dimensions, colour counts, thread/print colours, garment colour notes, underbase/white-ink/mirroring/cut-path flags, machine notes, orientation) is folded into one `productionMetadata: Json?` column rather than a dozen mostly-null columns — matching the existing convention (`ActivityEvent.metadata`, `KlaviyoDispatch.eventProperties`, `ManualOverride.previousValue`/`newValue`) for data that is structured but never individually queried or filtered. `decorationMethod` and `placement` remain real columns because validation and manifest logic branch on them directly.
- **`ProductionArtworkOrderLine`** — join table allocating a `ProductionArtwork` to specific order lines with quantities, mirroring the existing `ProofGroupOrderLine` pattern rather than inventing a new shape.
- **`ExportBatch`** — the dedicated, audited export action itself, scoped to an order (`batchNumber` sequential per order via `@@unique([orderId, batchNumber])`, same transactional-retry pattern), carrying its own `idempotencyKey` (unique) so a duplicate submission can never produce two packages, an immutable `manifestSnapshot`/`packageStorageKey`/`packageChecksum` once generated, and `previousBatchId`/`reexportReason` to record re-export lineage explicitly rather than overwriting history.
- **`ExportBatchItem`** — an immutable per-group snapshot row inside a batch: which `ProductionArtwork` and which exact `sourceProofVersionId`/`sourceProofVersionNumber` or `sourceNoProofReasonSnapshot` was actually included, plus a decoration/placement snapshot. This is deliberately a snapshot, not a live join, so a later edit to the group or artwork can never rewrite what a past export historically contained.

`ProofGroup.productionExports` and `ProofVersion.productionExports` are renamed to `productionArtworks`; `ShopifyOrder.exportBatches` and `ShopifyOrderLine.productionArtworkAllocations` are added.

## Current limitations

- `ExportBatchItem.sourceProofVersionId` is a plain string, not a foreign key — it is intentionally a point-in-time snapshot, so it must not cascade or be treated as a live relation. Any query needing the *current* state of that version must join through `ProductionArtwork.sourceProofVersionId` instead, not this field.
- As with ADR-0005, this decision reshapes a table with genuinely zero rows in every environment, so there was no data migration risk.

## Risks

None beyond the already-tracked ADR-0001 (single-instance) and ADR-0004 (local-disk storage, which production artwork files and export packages both depend on until the Cloudflare R2 migration lands).

## Conditions that trigger reconsideration

- If a future requirement needs an export batch to span multiple orders at once (today it is strictly one order per batch, matching the milestone's "order-level export readiness" framing).

## Required future work

None — this is considered a complete, stable shape for Milestone 10 and the deferred full production-queue/warehouse work that builds on it later.
