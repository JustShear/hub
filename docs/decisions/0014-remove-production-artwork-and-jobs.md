# ADR-0014: Remove Production Artwork, Export Batch, and Production Jobs

**Status:** Accepted.

## Context

Milestones 10 and 11 built a full in-Hub production pipeline: staff manually
prepared/uploaded a "Production Artwork" revision per proof group, "exported"
it into a formal Export Batch (manifest + downloadable package), which
auto-created Production Jobs/Tasks for a `/production` queue with
assignment, start/pause/complete, quantity tracking, and quality checks.

In practice the shop never adopted this. Real print files are prepared and
sent to production entirely through Dropbox, outside the Hub. The Kanban
board already gives staff everything the shop's real workflow needs:
dragging a card into **Exported for Print** (or tagging an order directly in
Shopify) syncs the real `"Exported for Print"` Shopify tag, which is the
only signal the shop's day-to-day process actually relies on. Production
Artwork was pure duplicate manual data entry with no downstream consumer.

## Decision

**Remove Production Artwork, Export Batch, and Production Jobs/Tasks/Quality
Checks/Issues/Notes entirely** — schema, domain logic, UI (order-drawer tab,
`/production` queue, dashboard section), routes, and permissions. The
`/production` queue itself was confirmed unused and removed too.

This system sat upstream of two things that had to be given independent
replacements rather than simply breaking:

- **Warehouse pick-job auto-creation** (Milestone 13) used to fire the
  moment `ShopifyOrder.productionSummary` reached `COMPLETE` — a value only
  ever set by Production Job/Task lifecycle events. It now fires off the
  same real-world signal the shop already tags orders with: the order
  gaining the **"Exported for Print"** Shopify tag. Two call sites detect
  this, both calling the existing, idempotent
  `createWarehousePickJobForOrder` — a manual Kanban drag into Exported for
  Print (`move-order-workflow-status.server.ts`) and a regular Shopify sync
  bringing the tag in fresh (`import-order.server.ts`'s
  `wasExportedForPrintJustNow`, mirroring the existing `wasFulfilledJustNow`
  pattern). A one-time backfill (`scripts/backfill-warehouse-pick-jobs.ts`)
  creates pick jobs for orders already tagged before this shipped.
- **Real freight-label creation** (Milestone 12, Starshipit) used to require
  `productionSummary === COMPLETE`. That gate is gone — staff are trusted to
  trigger label creation once the order reaches Pack, the same trust model
  already used by the "Mark fulfilled — no label needed" bypass. There was
  no Packing milestone/model to gate on before this change either (see
  ADR-0008); removing the production-completeness check just makes that
  pre-existing trust model consistent everywhere.

**Exceptions' REPRINT/EXCHANGE resolution stops doing anything beyond
recording the decision.** It used to call the real
`createExportBatch`/`reExportBatch` machinery to produce a genuine new
Export Batch → Production Job chain (see ADR-0010). With that machinery
gone, REPRINT/EXCHANGE now converge onto the exact same record-only shape
CREDIT/REFUND/DENIED already use — `proofGroupId` is still accepted on the
resolution input but no longer required or acted on. The user confirmed
this flow hasn't actually been tested/used yet and explicitly chose to
accept this now, deferring a real redesign until Exceptions is exercised
for real (verbatim: *"Remove Production Artwork now; fix Exceptions later
when we test it"*).

## Current limitations

- Exceptions REPRINT/EXCHANGE is now a pure record-keeping no-op — resolving
  a case that way logs the decision but does not create any real
  reprint/exchange artefact or task anywhere in the system. See
  `docs/technical-debt.md`.
- The `PRINT_STAFF` role (originally scoped to the removed production
  floor-work queue) is left in place with only its remaining
  view/proof/exception permissions rather than deleted outright, since
  removing a role outright is a bigger, separate decision than this cleanup.

## Risks

Low. This is a subtractive change with no new write paths; the two real
consumers (Warehouse, Freight) were given deliberately narrow, independently
verified replacements rather than left broken.

## Conditions that trigger reconsideration

- If Just Shear ever wants Exceptions REPRINT/EXCHANGE to do something real
  again (e.g. flag the order's "Needs printing" checkbox, or notify the
  print queue via Dropbox some other way) — to be designed once that flow is
  actually tested, per the deferral above.

## Required future work

None blocking. `scripts/backfill-warehouse-pick-jobs.ts` should be run for
real (`--apply`) against production data once this ships, to catch any
order that gained the "Exported for Print" tag before the new trigger
existed.
