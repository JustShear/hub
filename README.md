# Just Shear Production Hub

A production application connecting Shopify orders to artwork proofing, production, warehouse picking, packing, freight, fulfilment, reprints and returns.

**Stage One** (current focus): proofing and print-export handover.

> **⚠ Not approved for production use.** Two tracked blockers, not routine technical debt: (1) Shopify's `shop/redact` compliance webhook has no automated data-erasure workflow yet, and `customers/redact` only covers a subset of the models that may hold a customer's data — see [ADR-0002](docs/decisions/0002-deferred-shopify-privacy-erasure.md) and the proposed **Privacy, Retention and Shopify Data Erasure** milestone; (2) proof files are stored on local disk, not Cloudflare R2, which is unsafe under horizontal scaling or an ephemeral filesystem — see [ADR-0004](docs/decisions/0004-interim-local-disk-proof-storage.md). Both must be resolved before any real store/customer data touches this app.

## Source of truth

- [`docs/Just_Shear_Production_Hub_SRS_v1.1.docx`](docs/Just_Shear_Production_Hub_SRS_v1.1.docx) — the controlled Software Requirements Specification. Authoritative unless replaced by a later approved version (see its Section 1.1 change-control rule and Section 1.3 change log).
- [`docs/architecture/architecture-review.html`](docs/architecture/architecture-review.html) — pre-build architecture review: gaps closed, database schema, folder structure, and milestone plan (including the proposed Privacy/Erasure milestone).
- [`docs/development.md`](docs/development.md) — per-milestone developer documentation (Shopify scopes/webhooks, order-import architecture, retry/idempotency behaviour, known limitations).
- [`docs/decision-log.md`](docs/decision-log.md) — dated index of significant decisions, linking to full ADRs.
- [`docs/decisions/`](docs/decisions/) — architecture decision records (context, decision, limitations, risks, reconsideration triggers, required future work).
- [`docs/technical-debt.md`](docs/technical-debt.md) — open technical-debt register with status/severity.

## Status

**Milestones 01–08 complete and verified:**

- **01 — Repository and standards.** TypeScript (strict), React Router v8, ESLint, Prettier, Vitest, Playwright, GitHub Actions CI, fail-closed environment validation.
- **02 — Database foundation.** Full Prisma schema (~30 models per the architecture review), initial migration, seed data (roles, permissions, one admin login). Implemented ahead of sequence during Milestone 01's closeout and confirmed to stay.
- **03 — Authentication and roles.** Email+password staff sessions, RBAC permission checks, protected routes. No Shopify OAuth/App Bridge — per the SRS v1.1 change log, this is a standalone app with independent staff auth.
- **04 — Shopify order import.** GraphQL client, paginated order fetching, verified+idempotent webhooks (orders create/updated/cancelled plus the three mandatory privacy webhooks), the reusable `importShopifyOrder` service, OPTIS-property preservation with per-line artwork-asset linking, integration-failure tracking with exponential-backoff retry, and a dev CLI import tool. See [`docs/development.md`](docs/development.md) for the full architecture, scopes, webhook topics, and known limitations.
- **05 — Raw data inspector.** Developer-only screen (`/dev/orders`, gated behind a new `raw_data.view` permission) showing exactly what Milestone 04 imported: the raw Shopify payload and every line property — including OPTIS-style detected uploads and their linked artwork asset — with nothing filtered or reinterpreted.
- **06A — Application shell.** Reusable authenticated shell (header, permission-aware sidebar/mobile nav, user menu, breadcrumbs/page-header system, design tokens per SRS 19.1) that every page now renders inside; a dashboard landing page; a minimal read-only Integration Issues list; honest, non-functional shells for global search and notifications (no fake data); and a fix for the hardcoded dev seed password. See [`docs/development.md`](docs/development.md#application-shell-milestone-06a) for the shell architecture, how to add a nav item or page header, and the dev admin credential setup.
- **06B — Kanban board.** The main `/orders` operational board: 7 Stage One columns mapped from the existing `workflowStatus`/`proofSummary` enums (no schema replacement), accessible drag-and-drop (`@dnd-kit/core`) plus a keyboard-safe "Move to…" menu, server-authoritative status transitions with compare-and-swap idempotency and full audit logging, composable filters/sort/search, staff-specific saved views (existing `SavedView` model), a lightweight order preview (not the full drawer), and bounded/paginated queries designed for 1,000+ active orders. See [`docs/development.md`](docs/development.md#kanban-board-milestone-06b) for the column mapping, transition policy, performance strategy, and everything deferred to later milestones.
- **07 — Full order drawer.** The detailed internal order workspace opened from a Kanban card at a real, deep-linkable URL (`/orders/:orderId`), replacing the 06B preview dialog. Eight SRS-structured tabs (Overview, Products, Uploads, Notes, Shopify, Activity fully built; Proofs and Communication are honest placeholders); compare-and-swap editing of Hub-owned assignment/priority/due dates with full audit history; create-only internal notes; uploads grouped strictly by order line; a chronological activity timeline; and permission-controlled editing that never lets a Shopify sync overwrite a Hub-owned field. See [`docs/development.md`](docs/development.md#full-order-drawer-milestone-07) for the deep-linking architecture, permission model, editing/concurrency behaviour, and everything deferred to the proofing milestone. No proof-group creation, customer proof responses, export-for-print action, production/warehouse/packing screens, or Starshipit yet.
- **08 — Proof groups and proof versions.** The Proofs tab replaces its Milestone 07 placeholder: creating any number of proof groups per order, linking them to order lines and customer uploads (all genuinely many-to-many), a proof-required/not-required/undetermined decision with a reasoned, audited no-proof-required override, permanent versioned proof-file uploads (real file storage, magic-byte validation, checksum, concurrency-safe sequential version numbering, idempotent resubmission, never overwritten or deleted), internal readiness validation, artwork-staff assignment per group, internal notes, and an order-level proof summary calculated — never hand-set — from live proof-group state. See [`docs/development.md`](docs/development.md#proof-groups-and-proof-versions-milestone-08) for the full domain model, status state machines, and everything deferred to the customer-facing proofing milestone. No sending proofs to customers, customer approval/change-requests, production-artwork export, or production/warehouse/packing screens yet — and proof files live on local disk pending the Cloudflare R2 migration ([ADR-0004](docs/decisions/0004-interim-local-disk-proof-storage.md)).

`npm run typecheck`, `lint`, `format:check`, `test` (385 tests), `test:e2e` (2 tests), and `build` all pass with zero errors. Still no customer-facing proof-sending/approval workflow — see the architecture review for the full 23-milestone plan.

## Stack

- TypeScript (strict), React Router v8, standalone app — not an embedded Shopify admin app
- PostgreSQL + Prisma
- Cloudflare R2 for object storage (target; proof files currently on local disk pending Milestone 11 — see [ADR-0004](docs/decisions/0004-interim-local-disk-proof-storage.md))
- Klaviyo for customer-facing email (profile upsert + custom event tracking; Klaviyo Flows own the actual send)
- Hosted on Render
- Staff auth: email + password, admin-created accounts — no Shopify staff logins
- Vitest (unit/integration) + Playwright (e2e), ESLint + Prettier

## Authentication

Staff sign in at `/login` with an email + password created by an administrator (no self-signup, no Shopify staff accounts involved). A signed cookie session (`app/auth/staff-session.server.ts`) tracks who's signed in; every protected route's `loader` calls `requireStaffUser(request)`, which redirects to `/login?redirectTo=...` if there's no valid session and otherwise returns the staff user with their roles' permissions already flattened into a `Set`. `app/auth/rbac.ts`'s `hasPermission()` checks that set — it never touches the database itself, and has no `.server` suffix since components call it too (to decide what to render), so it's trivially unit-testable and safe in the client bundle.

`/logout` is a POST-only action (a form submission, not a link) so it can't be triggered by prefetch or a stray GET.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill in real values:

   ```bash
   cp .env.example .env
   ```

   The app validates every required variable at boot (`app/lib/env.server.ts`) and refuses to start if any are missing — see `.env.example` for what each one is and where it comes from. Optionally set `DEV_ADMIN_PASSWORD` if you want a password you choose rather than a generated one (also needed for `npm run test:e2e` — see below).

3. Start local Postgres (requires Docker Desktop) and apply migrations:

   ```bash
   docker compose up -d
   npm run db:migrate
   npm run db:seed
   ```

   This creates one seeded admin login: `admin@justshear.com`. There is no fixed default password — if `DEV_ADMIN_PASSWORD` was set in `.env` it's used, otherwise a random password is generated and printed to the console **once, the first time the admin account is created**. Re-running `db:seed` never changes an existing admin's password. Copy the printed password now if you didn't set `DEV_ADMIN_PASSWORD`.

4. Start the dev server and sign in with the seeded admin login above:

   ```bash
   npm run dev
   ```

   The app is available at `http://localhost:5173`.

## Scripts

| Script                         | Purpose                                               |
| ------------------------------ | ----------------------------------------------------- |
| `npm run dev`                  | Start the dev server with HMR                         |
| `npm run build`                | Production build                                      |
| `npm run start`                | Run the production build                              |
| `npm run typecheck`            | React Router type generation + `tsc`                  |
| `npm run lint`                 | ESLint                                                |
| `npm run format`               | Prettier — write                                      |
| `npm run format:check`         | Prettier — check only (used in CI)                    |
| `npm run test`                 | Vitest (unit/integration)                             |
| `npm run test:e2e`             | Playwright (e2e)                                      |
| `npm run db:generate`          | Regenerate the Prisma client after a schema change    |
| `npm run db:migrate`           | Create and apply a dev migration                      |
| `npm run db:migrate:deploy`    | Apply pending migrations (production)                 |
| `npm run db:seed`              | Seed roles, permissions and one admin login           |
| `npm run db:studio`            | Prisma Studio                                         |
| `npm run import:order --`      | Manually import one Shopify order by GID or name      |
| `npm run register:webhooks --` | Register this app's webhook subscriptions with a shop |

## Deployment

Targeting Render (managed Node hosting + managed Postgres, plus a second process for the background job worker once one exists). A `Dockerfile` is present from the project scaffold if a containerized deploy is ever preferred instead — not required for the current Render plan. Full deployment documentation lands in Milestone 23.

> **Single-instance only.** Background job processing (`app/lib/job-poller.server.ts`) runs as an in-process poller with no cross-instance locking. Running more than one instance of this application concurrently may cause the same job to be processed more than once. Do not enable horizontal scaling/autoscaling until this is replaced per [ADR-0001](docs/decisions/0001-single-instance-job-execution.md). Import operations are idempotent wherever the schema allows it, which limits (but does not eliminate) the practical impact of duplicate processing in the meantime.
