# Production readiness checklist (Milestone 16)

Synthesises every ADR and technical-debt item into one go/no-go document, as this milestone's own closing deliverable. This is a snapshot as of Milestone 16 — re-check it before any real production go-live, since new work after this milestone could change any of these answers.

## Bottom line

**This application is NOT yet approved for production use with real customer data.** One blocking item remains unresolved (Shopify privacy/data-erasure, below) and was explicitly out of scope for this "final polish" milestone from the start — see the Milestone 16 plan's own opening note. Everything else on this list is either resolved, or an accepted, documented, non-blocking limitation.

## Blocking items (must resolve before go-live)

| # | Item | Status |
| --- | --- | --- |
| 1 | **Shopify privacy/data-erasure** — `shop/redact` has no automated data-erasure workflow; `customers/redact` only covers `ShopifyOrder` fields, not the ~10 other models that may carry a customer's data | **STILL BLOCKING.** Not addressed this milestone — deliberately out of scope, per the Milestone 16 plan's own opening note. A dedicated future milestone ("Privacy, Retention and Shopify Data Erasure") is required before this app can legally/contractually handle real customer data under Shopify's Partner Program requirements. See [ADR-0002](decisions/0002-deferred-shopify-privacy-erasure.md). |

No other item in the technical-debt register is marked blocking as of this milestone.

## Constraints that remain true (not blockers, but must be respected)

| # | Constraint | Status |
| --- | --- | --- |
| — | **Single-instance deployment only** — the job poller (`app/lib/job-poller.server.ts`) has no cross-instance locking | **STILL A CONSTRAINT, unaffected by this milestone's work.** Milestone 16's "real-time updates" feature is a client-side polling-revalidation hook (`usePollingRevalidation`) — a browser periodically re-fetching a loader — which is unrelated to and does not touch server-side job coordination. Do not conflate the two: this milestone did not make horizontal scaling any safer. See [ADR-0001](decisions/0001-single-instance-job-execution.md), restated in `docs/deployment.md`. |

## Resolved this milestone

| Item | Resolution |
| --- | --- |
| Local-disk proof/artwork/export/freight-label storage (technical-debt item 13, [ADR-0004](decisions/0004-interim-local-disk-proof-storage.md)) | **RESOLVED.** Real Cloudflare R2 adapter built and wired via a factory swap ([ADR-0011](decisions/0011-cloudflare-r2-migration.md)). Caveat: connectivity against a real R2 bucket was not verified in this development environment (mocked-client tests only) — the first real deploy must smoke-test an actual upload/download/delete cycle before trusting it with real files. See `docs/deployment.md` prerequisites. |
| No barcode/scanner-driven pick confirmation (technical-debt item 34, [ADR-0009](decisions/0009-warehouse-picking.md)) | **RESOLVED.** Scan-to-fill quantity entry for Warehouse (SKU-validated, override-on-mismatch) and Production (informational only). See [ADR-0012](decisions/0012-barcode-scan-to-fill.md). |
| Production queue has no real-time cross-staff sync (technical-debt item 26); same limitation noted for the board (item 9), order drawer (item 12), warehouse queue (implicit) | **Substantially mitigated, not fully solved.** A 20-second client-side polling-revalidation hook now runs on every queue/board route, paused while the tab is backgrounded. This narrows the staleness window from "until next manual navigation" to "up to 20 seconds" — it is not real-time push (no WebSockets/SSE), a deliberate scoping decision given the single-instance constraint above. |
| Production/Warehouse/Exceptions had no saved-view feature, unlike the board (technical-debt item 27) | **RESOLVED.** `SavedView.scope` generalizes the model across all four queues; Production/Warehouse/Exceptions use a new generic layer (opaque query-string storage) rather than the board's typed filter schema, since their filter shapes don't match. |
| No login rate limiting | **RESOLVED.** In-memory, per-process attempt throttle (5 failed attempts per email+IP per 15 minutes) — see `docs/security-review.md` §7. Deliberately in-memory under the same single-instance rationale as the job poller; would need to move to a shared store if that constraint is ever lifted. |
| One IDOR gap found in manual security review: `createFreightShipment`'s idempotency-key lookup had no `shopId` scoping | **RESOLVED.** Fixed to scope by both `idempotencyKey` and `shopId`. See `docs/security-review.md` §2. |

## Non-blocking, accepted limitations (unchanged this milestone, still open)

These are deliberate scope boundaries or low-severity open items documented in `docs/technical-debt.md` — not re-litigated here in full. Notable ones worth surfacing at the go/no-go level:

- No rate limiting on the **public** `/proof/:token` customer-facing routes (item 17) — distinct from the login rate limiter added this milestone, which only covers staff `/login`.
- R2 adapter untested against a real bucket in this environment (item 41, see above).
- No signed-URL redirect for file downloads — every file-serving route still streams bytes through the Node process (item 40).
- Several Starshipit integration details (request-body shape, cancellation/void API) remain unconfirmed against a real sandbox account (items 29-31, [ADR-0008](decisions/0008-starshipit-freight-integration.md)).
- No real inventory/stock-level tracking in Warehouse picking — a checklist workflow, not a stock system (item 33, [ADR-0009](decisions/0009-warehouse-picking.md)).
- `ExceptionCaseAttachment` has no upload UI (item 38); no Shopify refund/store-credit mutation exists — resolutions are record-only by design (item 39).

See `docs/technical-debt.md` for the complete, numbered register — this checklist intentionally doesn't restate every item, only the ones that bear directly on a go/no-go decision.

## Verification performed for this checklist

- Full test suite green at time of writing (unit + integration; run `npm run test` to reconfirm before any real deploy — the count changes as work continues).
- `npm run typecheck`, `npm run lint` clean.
- `npm audit` (default and `--production`): 0 vulnerabilities.
- Manual security review performed and documented (`docs/security-review.md`) — permission ordering, IDOR sampling, secrets handling, XSS, session cookie flags, login rate limiting.
- Backup/restore procedure drilled against the real local dev database (`docs/backup-and-restore.md`) — dump/restore round-trip verified byte-for-byte in row/table counts.
- Deployment runbook written and cross-checked against the actual `package.json` scripts and `app/lib/env.server.ts` validation (`docs/deployment.md`) — every env var, every build/migrate/seed step traced to real code, not assumed.

## What would need to happen for a real go-live

1. Complete the deferred Shopify privacy/data-erasure milestone (the one blocking item above).
2. Provision the real infrastructure per `docs/deployment.md` (Render Postgres, R2 bucket, Shopify custom app, Klaviyo, Starshipit) and smoke-test the R2 adapter against the real bucket.
3. Re-run this checklist — a milestone or two may have passed since it was written, and its "resolved this milestone" section will be stale by then.
