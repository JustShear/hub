# Deployment (Milestone 16)

Full Render runbook. This replaces the one-paragraph placeholder previously in the README's Deployment section — see that section for the short pointer here, and `docs/production-readiness-checklist.md` for whether the app is actually cleared to go live yet (it currently is not — see that document).

## Topology: one Render Web Service, no worker dyno

**Only one Render service is needed: a single Web Service running `npm start`.** There is no separate background-worker process. The job poller (`app/lib/job-poller.server.ts`) starts in-process, idempotently, from `app/root.tsx`'s loader on the first request the running instance handles — it is a `setInterval` inside the same Node process serving HTTP requests, not a standalone script or a second Render service. (An earlier draft of the README anticipated "a second process for the background job worker" before this was actually built; that was wrong and has been corrected — no such second process exists or is needed.)

**This service must run as exactly one instance — no horizontal scaling, no autoscaling group.** The poller has no cross-instance locking: two running instances would each independently poll and could both pick up and process the same due job. See [ADR-0001](decisions/0001-single-instance-job-execution.md) for the full rationale and the conditions that would need to change before this constraint could be lifted. In Render's dashboard, this means setting the service's instance count to 1 and never enabling its autoscaling feature.

## Prerequisites (provision before first deploy)

1. **Render Postgres** (managed database) — any plan; a paid plan is required for the automatic daily backups this app's disaster-recovery plan relies on (see `docs/backup-and-restore.md`). Note the connection string Render provides — it becomes `DATABASE_URL`.
2. **Cloudflare R2 bucket** — create a bucket, then an API token scoped to it (Cloudflare dashboard → R2 → Manage API tokens). Note the account ID, access key ID, and secret access key — these become `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`. Also **enable bucket versioning** at this point (see `docs/backup-and-restore.md`).
3. **Shopify custom app** — in the target store's Shopify Admin → Settings → Apps → Develop apps, create (or reuse) a custom app with the Admin API scopes this app needs (orders, fulfillments, customer data — see the app's requested scopes at install time). Note the Admin API access token (`SHOPIFY_ADMIN_API_TOKEN`) and the app's API secret key (`SHOPIFY_API_SECRET_KEY`, used only for webhook HMAC verification — a different value from the access token). Register the store domain as `SHOPIFY_SHOP_DOMAIN`.
4. **Klaviyo account** — a private API key with campaign/profile/event scopes (`KLAVIYO_API_KEY`). Used only for customer-facing sends (proof-ready notifications); staff-facing alerts never go through Klaviyo.
5. **Starshipit account** — Settings → API for both `STARSHIPIT_API_KEY` and `STARSHIPIT_SUBSCRIPTION_KEY`. The subscription key sometimes needs to be enabled by Starshipit support if it isn't already visible.

## Environment variables

Every variable `app/lib/env.server.ts` validates at boot (the app fails closed and refuses to start if any required one is missing or invalid — only variable *names*, never values, ever appear in that error). Copy `.env.example` as the starting point; the table below is the same information with deployment context added.

| Variable | Required? | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | Postgres connection string. From Render's managed Postgres instance in production. |
| `SHOPIFY_SHOP_DOMAIN` | Required | The target store's `*.myshopify.com` domain. |
| `SHOPIFY_ADMIN_API_TOKEN` | Required | Custom app's Admin API access token — all Shopify GraphQL calls. |
| `SHOPIFY_API_VERSION` | Optional (default `2026-07`) | Admin GraphQL API version. Bump quarterly per Shopify's versioning schedule. |
| `SHOPIFY_API_SECRET_KEY` | Required | Custom app's API secret key — webhook HMAC verification only, never the access token above. |
| `R2_ACCOUNT_ID` | Required | Cloudflare account ID, for the R2 S3-compatible endpoint URL. |
| `R2_ACCESS_KEY_ID` | Required | R2 API token access key ID. |
| `R2_SECRET_ACCESS_KEY` | Required | R2 API token secret. |
| `R2_BUCKET` | Required | The R2 bucket name proof/artwork/export/freight-label files are stored in. |
| `KLAVIYO_API_KEY` | Required | Klaviyo private API key — customer-facing email sends only. |
| `STARSHIPIT_API_KEY` | Required | Starshipit API key — freight label creation/tracking. |
| `STARSHIPIT_SUBSCRIPTION_KEY` | Required | Starshipit subscription key (both headers are required on every Starshipit request). |
| `SESSION_SECRET` | Required (min 32 chars) | Staff session cookie signing secret. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — a fresh value per environment, never reused between dev and production. |
| `DEV_ADMIN_PASSWORD` | Optional | Sets the seeded dev admin's password. In production, leave unset — a random password is generated and printed to the deploy log **once**, at first seed, and never stored; see "First deploy" below for how to capture it. |
| `PROOF_TOKEN_EXPIRY_DAYS` | Optional (default `14`) | How long a customer proof-request link stays valid. |
| `PROOF_REMINDER_DELAY_DAYS` | Optional (default `3`) | Days after sending before the one automatic reminder fires if unresolved. |
| `APP_BASE_URL` | Optional (default `http://localhost:5173`) | **Must be overridden in every real deployment** to the app's actual public origin (e.g. `https://hub.justshear.com`) — embedded in the customer proof-portal link sent via Klaviyo. Getting this wrong sends customers a broken or locally-scoped link. |

Set all of these as Render environment variables on the Web Service (Render dashboard → your service → Environment). Never commit real values to `.env` in the repository.

## Build and deploy steps

1. **Provision the prerequisites above first** — the app will not boot without every required env var set.
2. Render builds via `npm run build` (configured as this service's build command) and starts via `npm start` (`react-router-serve ./build/server/index.js`) — both already defined in `package.json`, no custom Render build script needed beyond pointing at these two commands.
3. **Run the database migration before (or as part of) the first deploy**: `npm run db:migrate:deploy` (wraps `prisma migrate deploy` — applies every pending migration without prompting, the correct command for a non-interactive deploy environment; never use `db:migrate`/`prisma migrate dev` outside local development).
4. **Seed once, on first deploy only**: `npm run db:seed`. This creates the `Shop` row, the permission/role tables, and the one admin `StaffUser` account. Re-running it is safe (idempotent) but the admin account's password is only ever (re-)printed if the account doesn't already exist — see `prisma/seed.ts` and `scripts/reset-admin-password.ts` if access is later lost.
5. **Register Shopify webhooks** once the app is reachable at its real public URL: `npm run register:webhooks` (see `scripts/register-webhooks.ts`) — points Shopify at this deployment's `webhooks/orders/*` and `webhooks/customers/*`/`webhooks/shop/redact` endpoints. Re-run this if the app's public URL ever changes.
6. Capture the admin password from the deploy log immediately after the first seed run — it is printed once and never stored anywhere retrievable afterward.

## Confirming the single-instance constraint in Render

After the service is created, explicitly verify (don't just assume the default): the service's instance count is **1**, and its autoscaling setting (if Render's plan tier exposes one) is **off**. This is the same constraint stated in the README and in [ADR-0001](decisions/0001-single-instance-job-execution.md) — restated here because a deployment runbook is where an operator will actually be looking at the moment this matters, not just the README.

## Rollback

A bad deploy: use Render's own "roll back to previous deploy" feature (Render dashboard → Deploys tab). This reverts application code only — if the bad deploy included a destructive migration, restoring the database to before that migration also requires `docs/backup-and-restore.md`'s restore procedure (Render's point-in-time recovery, or a manual `npm run db:backup` snapshot if one was taken beforehand — see that document for why taking one before a risky migration is good practice).
