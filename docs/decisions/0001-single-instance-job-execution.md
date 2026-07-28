# ADR-0001: Single-instance background-job execution

**Status:** Accepted for current deployment shape. Not acceptable if horizontal scaling is introduced without further work.

## Context

Milestone 04 needed a way to process Shopify webhooks asynchronously — return a fast 200 response, then do the actual GraphQL fetch and database work without holding the request open. No job-queue infrastructure existed yet, and standing up a full distributed queue (e.g. Graphile Worker, as the architecture review originally suggested) was a substantial piece of infrastructure on its own, disproportionate to what Milestone 04 needed to prove out.

What was built instead: `ShopifySyncJob` rows in Postgres, drained by (a) a fire-and-forget call from the webhook route itself, and (b) `app/lib/job-poller.server.ts`, a `setInterval` running inside the same Node process, as a safety net for anything the fire-and-forget call missed (e.g. a restart mid-flight).

## Decision

Use a single in-process poller for Stage One. Do not build multi-instance coordination now.

## Current limitations

- `startJobPoller()` starts exactly one `setInterval` per Node process, guarded by a global flag. It does not coordinate with any other process.
- If two instances of this app run simultaneously, both pollers will independently query for the same `PENDING`/due-for-retry `ShopifySyncJob` rows and may both call `processShopifySyncJob` on the same job at close to the same time.
- `processShopifySyncJob` checks job status (`RUNNING`/`SUCCESS` short-circuit) before acting, which narrows the race window but does **not** eliminate it — there is no row-level lock (e.g. `SELECT ... FOR UPDATE SKIP LOCKED`, a Postgres advisory lock, or equivalent) preventing two processes from both reading `PENDING` and both proceeding to call `importShopifyOrder` for the same job before either has written back a status change.

## Risks

- **Duplicate order-import runs** for the same job under concurrent instances. `importShopifyOrder` itself is idempotent (upserts keyed on stable Shopify GIDs), so a duplicate run would not corrupt data or create duplicate rows — but it would waste a Shopify API call and could, in the retry-accounting layer, distort `attemptCount`/failure-record state if both runs fail or succeed at overlapping times.
- **Silent horizontal scaling.** If someone scales this app to multiple Render instances without reading this document, nothing fails loudly — the symptom is subtle duplicate processing, which is easy to miss in normal operation and only shows up under load or investigation.

## Conditions that trigger reconsideration

- Any decision to run more than one instance of this application concurrently (autoscaling, blue/green with both targets live, manual second instance for capacity).
- Job volume growing to the point where a single process can't drain the queue fast enough even with tuning.

## Required future work

Before horizontal scaling is enabled, replace or strengthen the poller with one of:
- A database-backed queue with transactional row locking (`SELECT ... FOR UPDATE SKIP LOCKED` on `ShopifySyncJob`).
- PostgreSQL advisory locks keyed on job ID.
- A managed queue system (SQS, Cloud Tasks, etc.).
- Graphile Worker or an equivalent distributed-safe job runner, as originally suggested in the architecture review.

Tracked as technical debt — see `docs/technical-debt.md`. Deployment documentation (Milestone 23) must state the single-instance requirement explicitly.
