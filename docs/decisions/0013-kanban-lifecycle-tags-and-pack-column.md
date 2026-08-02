# ADR-0013: Tag-driven Kanban columns and a Pack column with inline freight

**Status:** Accepted.

## Context

The Kanban board (Milestone 06B) has always been driven entirely by two internal, Hub-owned fields — `workflowStatus` and `proofSummary` — with Shopify `tags` used only for the sidebar filter, free-text search, and card badge chips. ADR-0008's own addendum (post-Milestone 16) already recorded that staff had asked about surfacing freight controls at the Kanban card level once an order enters a "Pack" stage, and that the team declined to build it then: *"that would require a real packing/pack-stage model that doesn't exist yet ... it remains unscoped future work if Just Shear wants it."*

Just Shear asked for exactly that, plus a broader redesign: most columns should instead reflect the real-world tagging workflow already used around the shop — some tags applied externally (staff tag orders in Shopify directly), others applied automatically by the Hub the moment it performs the corresponding internal action.

## Decision

**9 columns, left to right: New → Order Sheet Printed → Waiting on Customer → Proof Being Prepared → Proof Sent → Changes Requested → Proof Approved → Exported for Print → Pack.**

**Tag read/write split** (confirmed with the user via `AskUserQuestion`, two rounds):
- `p` (Order Sheet Printed) and `emailed` (Waiting on Customer) are applied **externally** — staff tag orders in Shopify directly (a manual pre-proofing email for `emailed`; an external/manual process for `p`). The Hub only ever reads these two tags.
- `proof_sent`, `proof_rejected`, `proof_accepted`, `Exported for Print` are applied **by the Hub** via a new `syncOrderLifecycleTag` function, at the exact moment `sendProofRequest`, `recordCustomerProofResponse`, and `createExportBatch` (respectively) already do their own internal work.

**Dragging**: New, Proof Being Prepared, and Pack stay interactive (manual drag, `workflowStatus`-driven) — the other six columns become automatic/read-only, extending the exact pattern already used for "Changes Requested"/"Proof Sent"/"Exported for Print" before this redesign.

**Pack is populated two ways, not one.** During implementation we found `workflowStatus === READY_TO_PACK` is not purely manual as originally assumed — `app/domain/warehouse/handover-warehouse-pick-job.server.ts` (Milestone 13, already shipped) already sets it automatically once a warehouse pick job is handed over. Rather than fight this, Pack is populated automatically via that existing handover *and* manually via drag, for orders that skip warehouse picking entirely (e.g. blank/no-proof-required simple orders). Both paths are kept — this is a feature, not a conflict, and required zero changes to the warehouse domain.

**Freight controls render inline on the Pack card itself** (`PackCardFreightControls.tsx`) — weight/dimensions, a "Get rates" button, the live rate list, and "Create freight label" — reusing the existing `orders.$orderId.freight.tsx` resource route and its `getDeliveryRates`/`createFreightShipment` intents completely unchanged. Only the create-flow is inline; download/cancel/retry-sync stay drawer-only, with a "Manage in order drawer →" link once a shipment exists — duplicating destructive/management actions onto the card wasn't asked for and isn't in scope.

**`syncOrderLifecycleTag`** (`app/domain/orders/sync-order-lifecycle-tag.server.ts`) mirrors `syncFreightTrackingToShopify`'s shape exactly (the app's only other Shopify write): never throws, records failures via `IntegrationFailure`/`IntegrationType.SHOPIFY_TAG_UPDATE` — an enum value that turned out to already exist in the schema, reserved-but-unused, confirmed via grep to appear only in a seed script and test fixtures. This closed the whole feature with **zero Prisma migrations**, matching this codebase's established "reserve ahead of the adapter" convention (`Barcode`/`ScanEvent`, R2 env vars, `READY_TO_PACK` itself). The Shopify `tagsAdd`/`tagsRemove` mutations are combined into one GraphQL request via field aliasing when a removal is needed; not atomic (Shopify accepts/rejects each independently), so the function checks each alias's `userErrors` separately and writes the local `tags` array to reflect exactly what landed in Shopify, never the idealised target state.

**Column-definition internals**: `board-columns.ts` defines each column as a raw rule (`ownMatches`, `ownWhere`, a `matchPriority` number) and *derives* the real `matches()`/`where` by automatically folding in "AND NOT any higher-priority rule's own condition." Hand-maintaining two independent exclusion lists — one for the JS predicate, one for the Prisma `where` fragment — is exactly the kind of thing that silently drifts once tags (which can coexist on one order, unlike a single-valued `workflowStatus`) drive most columns; deriving both from one rule set makes that impossible. Match priority (most-advanced-state-wins) is intentionally a different order from the columns' left-to-right display order.

**`FULFILLED` moves to its own special view.** The old 7-value `EXPORTED_STATUSES` catch-all (which included `FULFILLED`) is gone, replaced by a single tag-driven `exported_for_print` column. `FULFILLED` (set only by `syncFreightTrackingToShopify`) is now a 4th `SPECIAL_STATUSES` entry alongside `on_hold`/`cancelled`/`archived` — a fulfilled order leaves the active board entirely, shown in its own read-only tab via the already-generic `SpecialStatusList.tsx`. Low-risk, small, and a natural extension of an already-established pattern — not re-litigated with the user, just implemented and flagged.

**One-time backfill is a hard pre-deploy step, not optional.** The moment column placement switches from `workflowStatus`/`proofSummary` to tags, every order already mid-flight (sent/rejected/approved/exported before this shipped) has no corresponding Hub-applied tag yet and would silently fall back to "New." `scripts/backfill-lifecycle-tags.ts` computes what the *old* column logic would have placed each active order in and calls the real `syncOrderLifecycleTag` so Shopify carries the correct tag before cutover. Defaults to a dry run; `--apply` writes for real. Dry-run output was verified sane against the real dev database (22 of 43 active orders needed a tag) before considering this feature complete.

## Current limitations

- No sequencing/business-rule gating on drag transitions beyond the pre-existing "is the target column interactive" check — a manager can drag a card directly from New to Pack, same permissiveness the original design already had between its own interactive columns.
- A residual, low-probability eventual-consistency edge case: if a scheduled Shopify re-sync runs in the narrow window between a successful `tagsAdd`/`tagsRemove` response and Shopify's backend fully propagating that change internally, the re-sync could theoretically read stale tags and overwrite the Hub's freshly-written local value backward. Accepted as a generic, low-risk consequence of eventual consistency, not something this design can fully close (see `docs/technical-debt.md`).
- The inline Pack-card freight form only covers the create-flow; managing an already-created shipment (cancel, retry Shopify sync, download label) still requires opening the full order drawer.

## Risks

None beyond the already-tracked constraints this redesign inherits (ADR-0001 single-instance, ADR-0008's own Starshipit-integration risks). The tag-write mutation is the app's second-ever Shopify write (after `fulfillmentCreate`) and follows the exact same fail-closed, never-undo-a-real-event pattern.

## Conditions that trigger reconsideration

- If staff report the two externally-applied tags (`p`, `emailed`) drifting out of sync with reality often enough that the Hub should offer its own "print order sheet" / "log a pre-proofing email" actions instead of relying entirely on manual Shopify tagging.
- If the eventual-consistency edge case above is ever observed causing a real, user-visible board misplacement — would justify adding a short cooldown/lock on re-syncing tags immediately after a Hub-initiated write.
- If Just Shear wants shipment management (cancel/retry/download) available directly from the Pack card rather than only via the drawer.

## Required future work

None blocking — this is a complete, stable shape for the redesign as scoped. The backfill script must be run for real (`--apply`) against production data before this ships to staff.
