# ADR-0007: Production queue and workstation model (Milestone 11)

**Status:** Accepted.

## Context

Milestone 10 produced an immutable, exported record of exactly what's ready to be produced (`ExportBatch` + `ExportBatchItem` + `ProductionArtwork`). Milestone 11 needs to turn that record into trackable, staff-facing production work — a job/task hierarchy staff can queue, assign, start, pause, record quantities against, quality-check, and complete — without ever letting production drift from the exact artwork/allocation that was actually exported.

## Decision

Add five new models plus two new enums, all additive:

- **`ProductionJob`** — one row per `(ExportBatch, decorationMethod)` pair (`@@unique([exportBatchId, decorationMethod])` — the job-level idempotency guard: reprocessing a batch can never create a duplicate authoritative job). Sequential `jobNumber` per order, mirroring `ExportBatch.batchNumber`'s existing convention. Grouping by the **existing** `DecorationMethod` enum (5 values already established through the whole proofing/export pipeline) rather than inventing a wider "workstream" enum (DTF/press/sublimation/vinyl/external as new literal values) — a central label-mapping module provides human-facing workstream names without a second, divergent taxonomy from what was actually proofed and exported.
- **`ProductionTask`** — one row per `ExportBatchItem` by default (`@@unique([exportBatchItemId])` — the task-level idempotency guard). This is the addressable unit staff act on. `productionArtworkId`/`exportBatchItemId` are fixed at creation and never repointed — a later artwork revision or re-export can never mutate a historical task's file reference. `taskType` (`ProductionTaskType`) is schema-ready for genuine multi-step decomposition (print → press → QC) but every auto-created task defaults to `GENERAL` — the milestone's own instruction not to invent steps the current data doesn't define.
- **`ProductionQualityCheck`** — append-only log, one row per check attempt, never edited or deleted — a failed check followed by a later pass preserves full history rather than overwriting it.
- **`ProductionIssue`** — never hard-deleted; `proofGroupId`/`productionArtworkId` are loose snapshot references (no FK), matching `IntegrationFailure.relatedProofGroupId`'s existing precedent, since the real relational path is `productionTask -> proofGroup/productionArtwork`.
- **`ProductionNote`** — mirrors `ProofNote`'s exact shape and policy (internal only, no edit/delete, scoped to exactly one parent) at production scope.

`ShopifyOrder.productionSummary` (`OrderProductionSummary`) is added as a **second, independent** order-level rollup alongside `proofSummary` — an order can be `ALL_REQUIRED_PROOFS_EXPORTED` while production hasn't started, or `COMPLETE` in production while a later reprint reopens proofing; folding both lifecycles into one enum would conflate them. Never hand-set — see `recalculateOrderProductionSummary`.

Two new `OverrideType` values (`REOPEN_COMPLETED_PRODUCTION`, `OVERRIDE_PRODUCTION_QUANTITY`) reuse the existing `ManualOverride` framework rather than inventing a parallel override model.

Job/task status is **derived**, never hand-set directly by a staff action that starts/pauses/completes a task — the job's own status (and the order's `productionSummary`) is recalculated from its tasks, the same "recalculate, never write directly" principle as `recalculateOrderProofSummary`.

Both job and task carry a plain `version Int @default(1)` column for optimistic concurrency on mutations without a natural expected-status CAS to compare against (assignment, priority/due-date edits) — status transitions continue this codebase's established scoped-`updateMany`-on-expected-status pattern and bump `version` at the same time, so both mechanisms stay consistent.

## Current limitations

- `ProductionTask.sequenceOrder`/`dependsOnTaskId` are stored but not enforced this milestone — no blocking-on-dependency logic exists yet, since nothing in the current data models genuine multi-step dependencies. Reserved for a future milestone that needs it.
- `ProductionJob.assignedTeam` is a free-text label, not a `Team` model — "where supported," not a full department/roster feature.

## Risks

None beyond the already-tracked ADR-0001/ADR-0004 constraints (single-instance, local-disk storage) — quality-check/issue attachments reuse the same `localDiskStorageAdapter`.

## Conditions that trigger reconsideration

- If a real multi-step production process (e.g. DTF print → heat press → QC as genuinely separate, independently-timed tasks) needs to be modelled — `taskType`/`sequenceOrder`/`dependsOnTaskId` exist for this, but the creation logic that currently always emits one `GENERAL` task per `ExportBatchItem` would need to grow decomposition rules.

## Required future work

None — this is considered a complete, stable shape for Milestone 11 and the deferred warehouse/packing/Starshipit work that builds on it later.
