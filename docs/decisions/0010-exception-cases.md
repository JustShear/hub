# ADR-0010: Exception cases — returns, warranty claims, production defects (Milestone 14)

**Status:** Accepted.

## Context

Milestones 11, 12, and 13 each explicitly deferred "returns" and "reprint claims" as future work. This milestone builds that: everything that happens when something goes wrong after an order has otherwise moved through the pipeline — a customer return, a warranty claim, a production defect caught late — and the resolutions that follow (reprint, credit, refund, exchange), plus the investigation workflow to manage it.

Numbering note: the user referred to this as "Milestone 15," likely following the original architecture-review document's much finer-grained numbering (which reaches "Milestone 17" and is not the same sequence as this build log's M01–M13). In the actual build/decision-log/ADR numbering used throughout this repo, this is **Milestone 14** — the next one after M13.

## Decision

**One unified `ExceptionCase` model, not three.** Customer returns, warranty claims, and production defects all become one entity classified by `category` (`CUSTOMER_RETURN | WARRANTY_CLAIM | PRODUCTION_DEFECT | OTHER`), with one investigation workflow and one place resolutions get recorded — mirroring the `ProductionIssue`/`WarehouseIssue` precedent already used twice in this codebase (one entity + a reason-category enum) rather than three separate tables with duplicated plumbing. `initiatedBy` (`CUSTOMER | STAFF`) is a second, orthogonal enum — who raised it, independent of what kind of issue it is.

**Refunds and credits are record-only.** `ExceptionCaseResolution.amount`/`currencyCode` track the decision, amount, and reason as an audited record; no Shopify refund/store-credit mutation is ever called. Staff execute the actual refund or store credit themselves in Shopify admin. This keeps the Hub a pure system of record everywhere, the same boundary Section 11.1 of the SRS drew from the start — Shopify's own commerce APIs are the one place this milestone deliberately does not write to.

**Return labels are manual/external.** `ExceptionCase.returnLabelProvidedAt`/`returnLabelNote` just record the fact "a return label was provided" (plus a free-text note — carrier, tracking number). No label-generation API call, not even a reuse of the Starshipit adapter already integrated for outbound freight (Milestone 12) — return labels run in the opposite direction and weren't in scope this milestone.

**REPRINT and EXCHANGE both reuse `createExportBatch`/`reExportBatch` (Milestone 10) instead of new production machinery.** `resolveExceptionCase` calls the *existing* export-batch mechanism directly, with the case's reason as the `reexportReason`, storing the resulting `exportBatchId` on the `ExceptionCaseResolution` row. This produces a real `ExportBatch` → `ProductionJob`/`ProductionTask` chain the same way any other re-export does — no separate reprint-tracking model, and no new production-job-creation logic. The only difference between a REPRINT and an EXCHANGE resolution is *why* (defect vs. wrong size/customer preference), not *how* — both require the staff to pick which `ProofGroup` is being remade.

**A pre-existing, unused `Reprint`/`ReprintAsset` model (and its `ReprintReasonCategory`/`ReprintStatus` enums) was removed, not extended.** These were reserved in the original Stage One schema, before `ExportBatch`/`ProductionJob` existed (Milestones 10/11) — they modelled reprint production status as an entirely separate parallel state machine (`REPORTED → REVIEW_REQUIRED → APPROVED → WAITING_STOCK → READY_FOR_PRODUCTION → IN_PRODUCTION → QUALITY_CHECK → COMPLETE`), which would have duplicated, not reused, the real production pipeline that has existed since Milestone 11. Zero app code ever referenced these models. This mirrors exactly how Milestone 10 removed the similarly-stale `ProductionExport` placeholder once a richer model became possible — see that milestone's own schema-migration note.

**A resolution is decided, then separately marked completed.** `ExceptionResolutionStatus` (`PENDING | COMPLETED`) is a second explicit staff action (`markResolutionCompleted`) confirming the resolution was actually carried out externally (refund processed in Shopify, reprint physically done, exchange mailed) — nothing auto-completes silently, the same rule this codebase applies everywhere else (mark ready, complete task, hand over pick job).

**A case can accumulate more than one resolution over time.** `ExceptionCaseResolution` is a child table, not fields flattened onto `ExceptionCase` — mirrors `ProofVersion`'s "one row per decision event" precedent. A case denied and later reconsidered gets a second resolution row; the case's own `status` reflects only the latest terminal decision.

**No new `StaffUser` role.** Any existing role can report a case and add notes (`exception_cases.create`, `exception_notes.create`); only Administrator/Manager can update/assign/resolve/cancel one (`exception_cases.update/assign/resolve/cancel`) — mirrors exactly how Print Staff can create a `ProductionIssue` but never resolve one. Mirrors the "reuse existing roles" precedent from Warehouse Picking (Packing Staff reused rather than a sixth role added).

**Exception cases don't touch `ShopifyOrder.workflowStatus`, and there's no dedicated Kanban column.** A return can happen well after `FULFILLED`/`ARCHIVED`, entirely outside the normal linear pipeline — this is a new, independent tracking dimension, the same way `proofSummary`/`productionSummary`/`warehousePickSummary` are independent rollups alongside `workflowStatus`. The Kanban board gets only a boolean `hasOpenExceptionCase` indicator chip (batched, no-N+1, mirroring `hasOpenProductionIssue`'s exact query shape), linking out to the `/exceptions` queue.

**A dedicated `/exceptions` queue and `/exceptions/:caseId` workstation, on the scale of Production/Warehouse.** Given "investigation workflow" was explicitly requested and cases aren't well-represented on the Kanban board's forward-pipeline-oriented columns, this mirrors the Production/Warehouse precedent (named views, filters, priority/severity-aware sort) rather than staying order-drawer-only like Freight/Proofs. The order drawer's own Exceptions tab additionally includes an inline "Report a problem" create form — closer to Freight's in-drawer creation convenience — since exception cases are always staff-initiated, never auto-created the way `ProductionJob`/`WarehousePickJob` are.

## Current limitations

- No real Shopify refund/store-credit mutation — record-only, per the decision above.
- No return-label generation API call — manual/external fact-recording only.
- `markResolutionCompleted` never auto-completes a REPRINT/EXCHANGE resolution when its linked `ProductionJob` actually finishes — always a manual staff action this milestone. Technical-debt item 37.
- `ExceptionCaseAttachment` exists in the schema (mirrors `ProductionIssueAttachment`) but has no upload UI wired up yet this milestone. Technical-debt item 38.
- No item-level or Packing-milestone integration — the still-unbuilt Packing milestone is not a dependency of this one.

## Risks

None beyond the already-tracked ADR-0001 (single-instance) constraint — this milestone adds no new storage or external-API surface (it reuses `createExportBatch`'s existing storage path for REPRINT/EXCHANGE).

## Conditions that trigger reconsideration

- If Just Shear wants the Hub to actually execute Shopify refunds/store credit directly — a real product and risk decision, not something to bolt on speculatively now.
- If return-label generation becomes a genuine requirement — the existing Starshipit adapter could plausibly be extended for reverse-direction labels, but that's a new integration surface, not a small addition.
- If auto-tracking reprint/exchange completion against production status becomes valuable — `markResolutionCompleted` would need to subscribe to `recalculateOrderProductionSummary` the way `WarehousePickJob` creation does.

## Required future work

None blocking — this is a complete, stable shape for Milestone 14.
