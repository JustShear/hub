# ADR-0009: Warehouse picking (Milestone 13)

**Status:** Accepted.

## Context

Milestone 11 gets an order to `productionSummary === COMPLETE`. Milestone 12 (Starshipit freight) lets staff freight a completed order with no gate beyond permission — an explicit scope decision at the time, since no packing/warehouse model existed yet. This milestone fills the gap in between: turning "production is done" into a tracked staff task to physically gather every item for an order and hand it to packing.

Numbering note: this was described as "Milestone 12" in the architecture review's original suggested ordering (production queues → warehouse picking → Starshipit freight). Freight was built first per an earlier explicit user choice, out of that suggested order, so this is **Milestone 13** in the actual build log/decision-log/ADR numbering.

## Decision

**No real inventory tracking.** There is no SKU/bin on-hand-quantity model anywhere in this schema — only a generic `Barcode`/`ScanEvent` scaffold reserved for Stage Two scanning, with no quantity concept. Picking is a staff checklist workflow (confirm what was gathered per order line), not a system that deducts from a real warehouse stock count.

**Short picks allow partial handover.** A `WarehousePickItem` reaching `SHORT` (picked + short account for the full required quantity, but not everything was actually gathered) does not block `handoverWarehousePickJob` — a deliberate scope decision. It does auto-create a non-blocking `WarehouseIssue` (`STOCK_SHORTAGE`) documenting the shortage, mirroring `perform-quality-check.server.ts`'s auto-issue-on-rework pattern from Milestone 11.

**Reuses the existing `PACKING_STAFF` role.** Rather than adding a sixth `StaffUser` role, this becomes that role's first real job-execution capability set — it previously only had `freight_shipments.view/download`. Granted everything needed to run the pick queue day to day (`view, assign, record_quantity, mark_short, handover, issues.create, notes.create`), mirroring exactly how Print Staff in production can create but not resolve issues: issue resolution stays Manager-only.

**Manual entry only.** No barcode scanning UI this milestone — the reserved `Barcode`/`ScanEvent` tables stay exactly as unused as they already were. Quantity entry is the same button/form pattern as production's own quantity recording.

**One `WarehousePickJob` per order, a real DB constraint.** Unlike `ProductionJob`/`FreightShipment` (which can legitimately have more than one row per order), a pick job is 1:1 with an order — `@@unique([orderId])`. One `WarehousePickItem` per `ShopifyOrderLine`, created for every line regardless of decoration method — a blank, undecorated garment still has to be physically gathered.

**Job creation lives inside `recalculateOrderProductionSummary`, not spread across its 6 call sites.** `recalculateOrderProductionSummary` (`app/domain/production/recalculate.server.ts`) is the one writer of `productionSummary`, called at the end of every production-domain mutation. Rather than adding a follow-up call at each of its 6 existing call sites, `createWarehousePickJobForOrder` is invoked directly inside `recalculateOrderProductionSummary` itself, in the same transaction, the moment the summary transitions to `COMPLETE`. This is safe to keep in the same transaction — unlike Milestone 12's Starshipit API call, this is pure DB writes with no external I/O, so keeping it atomic with the summary flip gives *stronger* consistency, not weaker. Idempotency comes from `WarehousePickJob`'s own `@@unique([orderId])` plus a plain existence check; since this always runs inside the same transaction as the summary flip, there's no concurrent-race window to worry about the way `ExportBatch`/`ProductionJob` creation has to guard against with retry-on-unique-violation.

**Job status has no distinct "ready for handover" bucket.** `WarehousePickJobStatus` is `QUEUED | IN_PROGRESS | HANDED_OVER | CANCELLED` — once every item reaches a terminal state (`PICKED`/`SHORT`), the job's derived status stays `IN_PROGRESS` until the explicit `handoverWarehousePickJob` action fires. This mirrors how `ProductionTask` completion is always an explicit staff action even though `ProductionJob.status` is otherwise derived — a job's own status is never the same thing as "eligible to be handed over," which is what `evaluateHandoverEligibility` checks separately.

**Blocking issues are a query-time check, not a stored item status.** `WarehousePickItemStatus` has no `BLOCKED` value (simpler than `ProductionTask`'s model) — `recordPickQuantity` itself checks for an open blocking `WarehouseIssue` on the item and rejects while one exists, rather than storing a derived blocked flag on the item.

**Freight's own eligibility rule is untouched.** `evaluateFreightShipmentEligibility` (Milestone 12) still gates only on `productionSummary === COMPLETE`. Retroactively requiring `warehousePickSummary === HANDED_OVER` before freight is a real, separate decision for later — not an incidental side effect of adding picking (see "Conditions that trigger reconsideration" below).

**Finally makes `OrderStatus.READY_TO_PACK` reachable.** Reserved in the schema since the Milestone 06B board-column work, unreachable until now — `handoverWarehousePickJob` sets it, the same "this milestone finally reaches a long-reserved enum value" pattern as Milestone 12 reaching `FULFILLED`. `OrderStatus.PACKING` stays reserved for the still-unbuilt Packing milestone.

## Current limitations

- No real inventory/stock-level tracking, and no bin-location model (still just a `BarcodeType` value) — technical-debt item 30.
- No barcode/scanner-driven pick confirmation — technical-debt item 31.
- No dedicated Kanban column for `READY_TO_PACK` (folded into the existing exported-statuses catch-all) and no full `/warehouse/report` page, mirroring the same "not requested, don't build ahead of need" reasoning as several Milestone 10/11 deferrals.
- Item-level notes aren't supported (job-level only) and `WarehouseIssue` has no file-attachment sub-model, unlike `ProductionIssue`'s — simpler, since neither was requested this milestone.

## Risks

None beyond the already-tracked ADR-0001 (single-instance) constraint — this milestone adds no new storage or external-API surface.

## Conditions that trigger reconsideration

- If Just Shear wants freight labels blocked until a pick job is genuinely handed over — a real product decision to make once real usage patterns from this milestone and Milestone 12 are observed together, not something to bolt on speculatively now.
- If a genuine Packing milestone is added later — the current no-gate design for freight, and the "handover is the terminal state for this milestone" design for picking, would both need revisiting once a real packing workflow exists downstream.
- If real inventory/stock tracking becomes a genuine requirement — `WarehousePickItem`'s `pickedQuantity`/`shortQuantity` fields would need to interact with an actual stock ledger instead of being a self-contained per-order checklist.

## Required future work

None blocking — this is a complete, stable shape for Milestone 13 and the deferred packing/returns work that would build on it later.
