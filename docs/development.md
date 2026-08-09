# Developer documentation

This document covers things a developer needs to know that aren't obvious from the code alone. It grows milestone by milestone — this revision adds Milestone 07 (Full Order Drawer) on top of Milestones 01–06B.

## Shopify scopes

The app requests four scopes total:

- `read_orders`
- `read_products`
- `read_customers`
- `write_fulfillments` — added in Milestone 12 for `fulfillmentCreate` (writing tracking numbers back to Shopify after a Starshipit freight label is created); this doc originally said "no write scopes exist yet," which was true before that milestone and stale afterward

Configured once, manually, when the custom app is created in Shopify Admin → Settings → Apps → Develop apps. `Shop.scopes` in the database is a record of what was granted, not something the app negotiates at runtime. `prisma/seed.ts` writes `SHOPIFY_SHOP_DOMAIN`/`SHOPIFY_ADMIN_API_TOKEN` (from `.env`) into the `Shop` row on every seed run — re-run `npm run db:seed` after changing either value in `.env` to point the app at a different store.

### Getting a real Admin API access token (as of this store's Shopify account, mid-2026)

This section originally assumed the classic custom-app model: create the app, install it, and Shopify hands you a static `shpat_...` token directly with no OAuth involved. **That model no longer applies to every store** — depending on the Shopify account, "Develop apps" may only expose a Client ID/Secret pair (OAuth-style credentials) and no static token at all, even after installing the app and configuring scopes. If you hit this:

1. Create the app in Shopify Admin → Settings → Apps and sales channels → Develop apps, with **scopes configured and saved in Configuration → Admin API integration before installing** — scopes granted later via OAuth can only ever be a subset of what's checked here, so get this right first.
2. Install the app. Note the **Client ID** and **Secret** (called "Client ID and Secret" under Credentials, not "API key/secret key" as older Shopify docs describe).
3. **Don't bother with the client-credentials grant** (`grant_type: client_credentials` against `/admin/oauth/access_token`) — it authenticates fine but comes back with an empty `scope`, and every Admin API call then fails with `ACCESS_DENIED` regardless of what's configured. This app type requires actual merchant consent.
4. Do a one-time **authorization-code grant** instead:
   - Visit (as the logged-in store owner) `https://{shop}.myshopify.com/admin/oauth/authorize?client_id={client_id}&scope={comma-separated scopes}&redirect_uri={redirect_uri}&state={random nonce}` — the `redirect_uri` must match the app's configured **App URL** exactly (there's no separate "allowed redirection URLs" field for this app type).
   - Approve the consent screen. Shopify redirects to `{redirect_uri}?code=...&state=...` — the redirect target doesn't need to be a real working endpoint; just read the `code` out of the browser's address bar.
   - Exchange it immediately (codes are short-lived, single-use): `POST https://{shop}.myshopify.com/admin/oauth/access_token` with `{"client_id", "client_secret", "code"}` in the body. The response's `access_token` (a `shpat_...` string) is the real token — put it in `SHOPIFY_ADMIN_API_TOKEN`. Unlike the client-credentials token (which expires in ~24 hours), this one has no `expires_in` and behaves like a classic long-lived custom-app token.
5. Keep the Client ID/Secret around (e.g. as `SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET` in `.env`, outside the validated env schema) — you'll need them again if the token is ever revoked or a scope needs adding, since step 4 has to be repeated from scratch (a new authorization always re-confirms the full scope set, it doesn't incrementally add one scope).

Verified end-to-end against the real `just-shear.myshopify.com` store this way — see technical-debt item 5.

## Registered webhook topics

| Topic | Route | Purpose |
| --- | --- | --- |
| `orders/create` | `/webhooks/orders/created` | New order arrived |
| `orders/updated` | `/webhooks/orders/updated` | Existing order changed |
| `orders/cancelled` | `/webhooks/orders/cancelled` | Order cancelled |
| `customers/data_request` | `/webhooks/customers/data-request` | Mandatory privacy webhook |
| `customers/redact` | `/webhooks/customers/redact` | Mandatory privacy webhook |
| `shop/redact` | `/webhooks/shop/redact` | Mandatory privacy webhook |

Registering them against a real shop (there's no OAuth install flow to do this automatically):

```bash
npm run register:webhooks -- https://your-deployed-app.example.com
```

This calls `webhookSubscriptionCreate` for each topic via the Admin GraphQL API, using the shop's stored `adminApiToken`. Re-run it if the deployed URL ever changes. Some Shopify plans require the three privacy webhooks to be configured under Admin → Settings → Notifications → Compliance webhooks instead of via the API — the script prints a reminder of this.

## Local webhook testing

There's no live Shopify store wired up in development, so webhooks are tested by posting synthetic, correctly-signed requests directly at the dev server. `SHOPIFY_API_SECRET_KEY` in your local `.env` is the signing secret — sign the exact raw JSON body with it:

```bash
node -e '
const crypto = require("crypto");
const body = JSON.stringify({ admin_graphql_api_id: "gid://shopify/Order/1234567890" });
const secret = "<value of SHOPIFY_API_SECRET_KEY in your .env>";
const hmac = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
console.log(hmac);
'
```

Then:

```bash
curl -X POST http://localhost:5173/webhooks/orders/created \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Shop-Domain: <your Shop.shopifyDomain>" \
  -H "X-Shopify-Webhook-Id: $(uuidgen)" \
  -H "X-Shopify-Topic: orders/create" \
  -H "X-Shopify-Hmac-Sha256: <hmac from above>" \
  -d '{"admin_graphql_api_id":"gid://shopify/Order/1234567890"}'
```

A 200 response means it was accepted and queued. Since the queued job then calls the real Shopify GraphQL API to fetch the order, this only actually imports something if `gid://shopify/Order/1234567890` is a real order your `SHOPIFY_ADMIN_API_TOKEN` can read — for testing against a real store, use `npm run import:order` instead (below), or a tunnel (ngrok / Cloudflare Tunnel) plus Shopify's own webhook delivery to exercise the full path end to end.

Automated test coverage for webhook verification/idempotency/rejection lives in `tests/integration/routes/webhooks.orders.test.ts` and `webhooks.privacy.test.ts` and doesn't need any of the above — it calls the route `action` functions directly with constructed `Request` objects.

## Order-import architecture

```
Webhook route (verify HMAC, validate shop domain)
  -> enqueueOrderImportJob (idempotent on X-Shopify-Webhook-Id)
  -> 200 response returned immediately
  -> fire-and-forget: processShopifySyncJob
       -> importShopifyOrder (the one reusable service)
            -> fetchShopifyOrder (paginates line items)
            -> upserts ShopifyOrder + ShopifyOrderLine + ShopifyLineProperty
            -> links CustomerArtworkAsset for detected file-upload properties
            -> records ActivityEvent(s)
       -> updates ShopifySyncJob status
       -> records/resolves IntegrationFailure
```

`app/lib/job-poller.server.ts` runs an in-process interval (every 30s) as a safety net that picks up anything still `PENDING` or due for retry — covers the case where the fire-and-forget call never got to finish (e.g. a deploy restarted the process mid-request).

**`importShopifyOrder` is the only import implementation.** Webhooks, `npm run import:order`, and any future manual-refresh/backfill feature all call it directly — nothing re-implements order-fetching or upserting elsewhere.

### Known simplification: single in-process poller

The poller is a `setInterval` inside the same Node process serving requests — fine for Stage One's single-instance deployment, but it doesn't coordinate across processes. If this app ever runs multiple instances, replace it with a real distributed queue (the architecture review recommends Graphile Worker) before that becomes a correctness problem, not just a scaling one.

## Shopify-owned vs. Production Hub-owned fields

`ShopifyOrder` and `ShopifyOrderLine` are explicitly split in `prisma/schema.prisma` with comments marking the boundary. The rule enforced in code, not just convention: `importShopifyOrder`'s `update` payload to Prisma only ever contains Shopify-owned fields — `workflowStatus`, `proofSummary`, `priority`, and everything else Hub-owned is never part of that object, so Prisma's generated `UPDATE` statement physically cannot touch them, regardless of what Shopify sends.

Shopify-owned: customer info, tags, financial/fulfilment status, addresses, totals, discounts, cancellation fields, line item product/variant/quantity/image data, line properties.

Hub-owned: `workflowStatus`, `proofSummary`, `priority`, assignments, due dates, notes, manual overrides, proof groups/versions, integration failures.

## OPTIS property-preservation strategy

`app/domain/orders/optis-property-parser.ts` is a pure function with no knowledge of OPTIS's actual data shape — it only applies generic heuristics (does this look like a URL? does it look like an uploaded file, by extension or hosting pattern?) to whatever `{key, value}` pairs Shopify's `customAttributes` contains. Every property is preserved regardless of classification; nothing is dropped.

The `config` parameter (`knownFileUploadPropertyNames`, `knownSelectionPropertyNames`) is the extension point for administrator-configured mappings once real OPTIS payloads are available to calibrate against — currently unused (empty), by design, rather than guessing at a schema nobody has inspected yet.

Detected-but-uncertain cases are represented as `URL` (confirmed to be a link, not confidently a file) rather than silently defaulting to `TEXT` or guessing `FILE_UPLOAD` — this is the "record parsing uncertainty rather than silently discarding the value" requirement. `CustomerArtworkAsset.parsingUncertain` exists in the schema for the same reason, for future use once the parser is confident enough to sometimes flag doubt at the asset level too.

## Retry and idempotency

- **Webhook delivery**: idempotent on `X-Shopify-Webhook-Id` (`ShopifySyncJob.idempotencyKey`, unique constraint). A duplicate delivery hits the constraint and is treated as already-queued.
- **Order upsert**: idempotent on `ShopifyOrder`'s `[shopId, shopifyOrderGid]` unique constraint.
- **Order-line upsert**: idempotent on `ShopifyOrderLine`'s `[orderId, shopifyLineGid]` unique constraint.
- **Artwork asset dedup**: idempotent on `CustomerArtworkAsset`'s `[shopId, sourceUrl]` unique constraint — the same uploaded-file URL reused across lines/re-imports never creates a duplicate asset row.
- **Retries**: exponential backoff (`app/domain/integrations/record-failure.server.ts`, `computeNextRetryDelayMs`) — 1 minute base, doubling, capped at 1 hour, giving up (status `NEEDS_ATTENTION`, no further auto-retry) after 8 attempts. Invalid webhook signatures are never retried — they're rejected before anything is queued.

## Raw payload retention

`ShopifyOrder.rawPayload` stores the complete raw GraphQL response for the order (not a sanitised subset — the full payload has no access tokens or secrets in it, only order data). `rawPayloadPurgeAt` exists in the schema for a future retention job to populate and act on; no automatic purge runs yet — this is a known gap, not a decision that raw payloads are kept forever. Raw payloads are never rendered in any current UI (there isn't one yet) and are explicitly intended for Milestone 05's developer-only raw data inspector, not for normal operational users.

## Running the development import command

```bash
npm run import:order -- "gid://shopify/Order/1234567890"
npm run import:order -- "#1001"
npm run import:order -- 1001
```

Resolves a name/number to a GID via a Shopify order search query if you didn't pass a GID directly, then calls the exact same `importShopifyOrder` service webhooks use.

## Known limitations requiring validation against real Just Shear orders

- **GraphQL query field names** (`app/adapters/shopify/orders.server.ts`) are based on long-standing, stable parts of the Admin GraphQL schema, but have not been run against a live store or verified via introspection. Validate before production use.
- **`fulfilledQuantity`** is computed as `quantity - fulfillableQuantity`. This is a reasonable, commonly-used approximation but hasn't been checked against real refund/restock edge cases.
- **OPTIS property detection** is entirely heuristic (URL shape, file extension, known CDN hosts) since no real OPTIS payload has been inspected yet (SRS's own flagged risk, Section 26). Expect to add `knownFileUploadPropertyNames`/`knownSelectionPropertyNames` entries once real payloads are seen.
- **`shop/redact`** currently only logs receipt for manual follow-up — it does not perform full automated data erasure. Building that safely (it would touch most of the schema) needs a dedicated, reviewed design, not an ad hoc addition here.
- **Address/discount/fulfilment data** is stored as opaque `Json` snapshots (`shippingAddress`, `billingAddress`, `discountCodes`, `fulfillments`) rather than normalised columns — sufficient for Stage One's needs (nothing queries into these yet), but revisit if a future milestone needs to filter or report on them directly.

## Application shell (Milestone 06A)

Every authenticated page renders inside `app/components/shell/AppShell.tsx`, mounted once by the pathless layout route `app/routes/app.tsx`. `app.tsx`'s `loader` is the single place `requireStaffUser` runs for the shell itself and where the real unresolved-integration-issue count is fetched (`countUnresolvedIntegrationFailures`); every nested route still calls `requireStaffUser` and any permission check itself — a route must never rely on an ancestor layout for its own authorization.

```
app/routes/app.tsx (layout route: requireStaffUser + integrationIssueCount)
  -> AppShell (computes getVisibleNavigation once, passes it down)
       -> AppHeader (brand link, MobileNavigation, GlobalSearch, IntegrationIssueIndicator, NotificationMenu, UserMenu)
       -> AppSidebar (desktop-only, `lg:` breakpoint)
       -> <Outlet /> (the actual page: dashboard, integrations, dev/orders, ...)
```

`/` (`home.tsx`) is not a page — its `loader` calls `requireStaffUser` then redirects to `/dashboard`. It exists only so a bare `/` resolves somewhere sensible.

### Navigation configuration

`app/lib/navigation.ts` is the single source of truth for the nav tree, consumed identically by `AppSidebar` and `MobileNavigation` (via the shared `NavLinks` component) so the two can never disagree. Each item has:

- `label`, `href`, `icon` (a `lucide-react` component reference)
- `permission?` — omitted means visible to any signed-in staff member
- `implemented` — `false` hides the item from every rendered nav entirely, regardless of permission. The full SRS Section 9 module list (Orders, Proofing, Production, Warehouse, Packing, Returns, Settings, Staff and Permissions) is already declared here with `implemented: false`; later milestones flip the flag to `true` as each route actually ships, instead of restructuring this file per milestone. **Never build a placeholder page just to flip a nav item on** — leave it `false` until the real route exists.
- `badge?` — currently only `"integrationIssues"`, resolved against the real count passed down from `app.tsx`'s loader.

`getVisibleNavigation(staffUser)` is the only place filtering happens (implemented + permission), and `isNavItemActive(item, pathname)` decides the active/aria-current state at render time — neither is duplicated in a component.

**To add a nav item**: add an entry to the appropriate group in `NAVIGATION` with `implemented: true` once its route exists. Nothing else needs to change — both the sidebar and the mobile drawer pick it up automatically.

### Page headers and breadcrumbs

`app/components/shared/PageHeader.tsx` renders the one `<h1>` a page is allowed (route content below it should start at `<h2>`), plus an optional description, status badge, and primary/secondary actions. `app/components/shared/Breadcrumbs.tsx` is a plain `<nav aria-label="Breadcrumb"><ol>` with `aria-current="page"` on the last, non-linked crumb.

**To add a page header**: call `<PageHeader title="..." breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "This Page" }]} />` at the top of the route component. Only the dashboard (the nav root) omits breadcrumbs — every other page should include a path back to it.

### Design tokens

`app/app.css`'s `@theme` block (Tailwind v4, CSS-first config) is the only place the SRS Section 19.1 palette is defined — components reference the generated utilities (`bg-page`, `text-ink`, `border-border`, `bg-accent-blue`, etc.) rather than raw hex values. `prefers-reduced-motion` is handled globally in the same file, so individual components don't need their own media query.

Avoid literal `*/` inside CSS comments (even across "bg-*, text-*, border-*"-style prose) — Vite's CSS minifier reads it as the comment's actual close token and corrupts the following rule. Say "background, text, and border utilities" instead.

### Accessibility notes

- Mobile navigation (`MobileNavigation.tsx`) and both dropdown menus (`UserMenu.tsx`, `NotificationMenu.tsx`) are built on Radix primitives (`@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`) specifically so focus trapping, `Escape`-to-close, and keyboard menu navigation come for free and stay correct — don't hand-roll these interactions.
- Every icon-only control has an `aria-label`; icons themselves are `aria-hidden="true"`.
- Nav links use `aria-current="page"` rather than colour alone to signal the active page.

### Search and notifications are shells, not features

`GlobalSearch.tsx` (opens on click, `/`, or Ctrl/Cmd+K) and `NotificationMenu.tsx` both have no backing data source yet. Per the "never present placeholder behaviour as complete" rule, they show an honest message (`EmptyState`: "Search isn't available yet" / "No notifications yet") rather than a fake input or seeded notification items. When a real search or notification feature is built, replace the body of these two components — their trigger buttons, keyboard shortcut, and position in `AppHeader` don't need to change.

`app/routes/integrations.tsx` is similarly intentionally minimal: a read-only list of unresolved `IntegrationFailure` rows gated on `integrations.view`. Retry/assign/resolve actions are SRS Section 19's own milestone, not part of this shell.

### `rbac.ts` has no `.server` suffix, on purpose

`hasPermission()` moved from `app/auth/rbac.server.ts` to `app/auth/rbac.ts` in this milestone. It's a pure function (no DB access, no secrets) that components now call directly to decide what to render (`PermissionGate`, nav visibility, dashboard shortcuts, the header's integration-issue icon) — React Router's bundler refuses to let client code import anything with a `.server.ts` suffix, so keeping that suffix on a module client components need is a build error, not just a style choice. If a future module is genuinely safe for the client bundle (no secrets, no I/O), don't give it a `.server` suffix even if it currently happens to only be called from a loader.

### Dev admin credentials

`prisma/seed.ts` no longer hardcodes a password. If `DEV_ADMIN_PASSWORD` is set (see `.env.example`), the seeded admin gets that password; otherwise a random one is generated and printed to the console **once, only when the admin account is first created** — reseeding an existing account never touches its password. Set `DEV_ADMIN_PASSWORD` in your local `.env` if you want a stable password across reseeds, or if you plan to run `npm run test:e2e` (the Playwright config loads `.env` via `process.loadEnvFile()` and the auth spec reads the same variable — it throws a clear error rather than failing on a login timeout if the variable is unset). In `NODE_ENV=production`, seeding refuses to create an admin at all unless `DEV_ADMIN_PASSWORD` is explicitly set — production admin provisioning should be a deliberate, out-of-band action, not a side effect of running the seed script.

### Known limitations deferred past Milestone 06A

- The nav groups for Orders, Proofing, Production, Warehouse, Packing, Returns, Settings, and Staff and Permissions exist in `navigation.ts` but are `implemented: false` — there is nothing to link to yet. This is expected, not a bug.
- `GlobalSearch` and `NotificationMenu` are intentionally non-functional shells (see above).
- `/integrations` is read-only; retrying, assigning, or resolving a failure is out of scope here.
- No staff-account management UI exists yet (`staff.manage` is defined as a permission but nothing in the shell uses it beyond hiding the nav item).

## Kanban board (Milestone 06B)

`/orders` (`app/routes/orders.tsx`) is the Stage One operational board — the main day-to-day workspace for staff, but deliberately not the full order drawer (that's a later milestone; see "Deferred to later milestones" below).

### Route and permissions

- **View**: `board.view` — already existed (Milestone 03's seed), reused as-is. Granted to all four staff roles.
- **Manage (drag/move)**: `board.manage` — new in this milestone, mirroring the existing `integrations.view`/`integrations.manage` pairing convention. Granted to Administrator, Manager, and Artwork Staff; not Print Staff or Packing Staff (their existing grants were already view-only).
- Every check happens in `orders.tsx`'s `loader`/`action` server-side — the client only uses permission flags to decide what to *render* (hide the drag handle, grey out disabled destinations), never as the actual authorization boundary.
- A signed-out request redirects to `/login`; a signed-in request without `board.view` gets a 403 `Response`, same pattern as every other protected route.
- The "Orders" nav item (`app/lib/navigation.ts`) is gated on `board.view` and only renders for authorised staff.

### Board-column mapping (redesigned — see ADR-0013)

Superseded the original 7-column, purely `workflowStatus`/`proofSummary`-driven design above. **9 columns now**, most driven by real Shopify order tags rather than internal state — `app/domain/orders/board-columns.ts` is still the *one* place the mapping happens, but it now reads `ShopifyOrder.tags` (`BoardOrderLike.tags`) as well as `workflowStatus`:

| Display order | Column | Rule | Interactive? |
| --- | --- | --- | --- |
| 1 | New | `workflowStatus = NEW`, or the structural catch-all when nothing more specific matches | Yes → sets `NEW` |
| 2 | Order Sheet Printed | tag `"p"` — applied **externally**, staff tag the order in Shopify directly | No |
| 3 | Waiting on Customer | tag `"emailed"` — applied **externally**, a manual pre-proofing email staff send outside the Hub | No |
| 4 | Proof Being Prepared | `workflowStatus IN (ARTWORK_REQUIRED, PROOFING_IN_PROGRESS, WAITING_CUSTOMER)` | Yes → sets `PROOFING_IN_PROGRESS` |
| 5 | Proof Sent | tag `"proof_sent"` — applied **by the Hub** when `sendProofRequest` succeeds | No |
| 6 | Changes Requested | tag `"proof_rejected"` — applied **by the Hub** when a customer response's recalculated aggregate is `CHANGES_REQUESTED` | No |
| 7 | Proof Approved | tag `"proof_accepted"` — applied **by the Hub** when the recalculated aggregate is `PARTIALLY_APPROVED`/`ALL_REQUIRED_PROOFS_APPROVED` | No |
| 8 | Exported for Print | tag `"Exported for Print"` — applied **externally** in Shopify, or **by the Hub** via a manual drag (`syncOrderLifecycleTag`), which also auto-creates the order's `WarehousePickJob` | Yes (shopifyTag-driven) |
| 9 | Pack | `workflowStatus IN (READY_TO_PACK, PACKING)` — set automatically by `handoverWarehousePickJob` (Milestone 13) *or* manually by drag, for orders that skip warehouse picking entirely. Freight controls (weight/dimensions, live rates, create label) render inline on the card — see the Freight section below. | Yes → sets `READY_TO_PACK` |

`ON_HOLD`, `CANCELLED`, `ARCHIVED`, and **`FULFILLED`** (new — see below) never appear on the main board at all (`isSpecialStatus`) — each lives in its own read-only tab.

**Why tags, not new `OrderStatus` values**: the shop already tags orders in Shopify for reasons independent of this app (staff workflow, other tools), and four of the six tag-driven columns map directly onto actions the Hub already performs internally — reusing that existing signal avoids inventing a parallel, easily-desynced concept. Two tags (`p`, `emailed`) are intentionally read-only from the Hub's side since they're applied by processes outside it.

**Column-definition internals**: each column is defined as a raw rule (`ownMatches`, `ownWhere`, a `matchPriority` number) in `board-columns.ts`'s `RULES` array, and the real `matches()`/`where` are *derived* by automatically folding in "AND NOT any higher-priority rule's own condition." This is deliberate — hand-maintaining two independent exclusion lists (one for the JS predicate, one for the Prisma `where` fragment) is exactly the kind of thing that silently drifts once tags (which can coexist on one order, unlike a single-valued `workflowStatus`) drive most columns. `matchPriority` order (most-advanced-state-wins, used only to resolve an order carrying multiple applicable signals) is intentionally different from `BOARD_COLUMNS`' display order — see the file for both.

**To add a workflow status safely**: add the new `OrderStatus` enum value in `prisma/schema.prisma` (migration), then add it to the relevant rule's `ownMatches`/`ownWhere` in `board-columns.ts`'s `RULES` array (or to `SPECIAL_STATUSES` if it should never appear on the main board). The "every non-special status resolves to a column" unit test will fail loudly if you forget.

**To add a new Hub-applied lifecycle tag**: call `syncOrderLifecycleTag` (`app/domain/orders/sync-order-lifecycle-tag.server.ts`) after the relevant domain function's transaction commits, wrapped in an awaited `try { ... } catch {}` (the function never throws under normal operation and records its own failure via `IntegrationFailure`/`SHOPIFY_TAG_UPDATE` — the outer catch is a defensive backstop only, mirroring `create-freight-shipment.server.ts`'s own call to `syncFreightTrackingToShopify`). Pass `removeTags` for every other lifecycle tag this stage supersedes, so at most one Hub-owned lifecycle tag is ever active on an order at a time.

### `FULFILLED` → its own special view

Since the old 7-value `EXPORTED_STATUSES` catch-all (which folded in `FULFILLED`) is gone, replaced by a single tag-driven `exported_for_print` column, `FULFILLED` (set only by `syncFreightTrackingToShopify` on a successful Shopify tracking write-back) needed an explicit new home. It's now a 4th `SPECIAL_STATUSES` entry, alongside `on_hold`/`cancelled`/`archived` — a fulfilled order leaves the active board entirely and appears in its own "Fulfilled" tab via the already-generic `SpecialStatusList.tsx`. `BOARD_VIEWS` (`board-filters.ts`) and `VIEW_TABS` (`BoardPage.tsx`) both gained the new `"fulfilled"` entry; `orders.tsx`'s loader and `SpecialStatusList.tsx` needed zero changes, both already fully generic over `SpecialViewKey`.

### One-time tag backfill (pre-cutover)

The moment column placement switched from `workflowStatus`/`proofSummary` to tags, every order already mid-flight (sent/rejected/approved/exported before this shipped) had no corresponding Hub-applied tag yet — it would otherwise silently fall back to "New." `npm run backfill:lifecycle-tags` (`scripts/backfill-lifecycle-tags.ts`) computes what the *old* column logic would have placed each active order in and calls the real `syncOrderLifecycleTag` so Shopify carries the correct tag before cutover. Defaults to a dry run (prints what it would tag, touches nothing); pass `--apply` to actually write. This is a one-time, throwaway script — it deliberately re-implements the old priority order rather than importing from the (now different) `board-columns.ts`.

### Status-transition policy (temporary — will tighten)

`app/domain/orders/workflow-transitions.ts`'s `canMoveOrderToColumn` is the single, server-authoritative policy (`move-order-workflow-status.server.ts` calls it independently of whatever the client sent) — unchanged by the redesign above, since it's already fully generic over the column config. Only **3 of the 9 columns are drag/Move-to destinations** now:

- **New**, **Proof Being Prepared**, **Pack** — interactive; dropping a card sets `workflowStatus` to that column's representative value (`NEW`, `PROOFING_IN_PROGRESS`, `READY_TO_PACK` respectively).
- The other six columns are read-only, each carrying a `readOnlyReason` explaining what actually sets it (a Shopify tag, applied either externally or by the Hub — see the redesign section above).
- Any order whose `workflowStatus` is `ON_HOLD`, `CANCELLED`, `ARCHIVED`, or `FULFILLED` cannot be moved anywhere from the board — reactivating one isn't supported yet (no matching `OverrideType` exists for it, and building a full override-approval flow remains out of scope).

The policy remains deliberately permissive beyond these checks — any interactive column to any other interactive column, any direction, no sequencing rules (e.g. New → Pack directly is allowed, same as New → Proof Approved was allowed under the original design).

### Moves: idempotency and auditing

`moveOrderWorkflowStatus` (`app/domain/orders/move-order-workflow-status.server.ts`) is the only writer of `workflowStatus` for board-driven moves:

1. Reads the order fresh. If it's already at the requested target, returns `already_there` — **checked before** comparing against the client's claimed "expected" status, so an exact duplicate/retried submission (the first request actually succeeded, the client resubmits after a lost response) is a safe idempotent no-op, not a confusing conflict.
2. If the order's real status doesn't match what the client expected, returns `conflict` (someone else changed it) — no write happens.
3. Otherwise, the transition policy is checked, then a compare-and-swap `updateMany` (scoped to the expected status) performs the write — a genuine race with another request is caught here even if steps 1–2 both passed.
4. Only a real transition writes an `ActivityEvent` (`eventType: "workflow_status_changed"`, `metadata: { previousStatus, newStatus, source: "kanban_board" }`, `actorStaffId`, `actorType: STAFF`) — no event on `already_there` or rejected/conflict outcomes, so retries never create duplicates.

### Default sort and available sort fields

`urgency_default` (the default) orders by: **1)** priority tier (URGENT, then HIGH, then NORMAL/LOW), **2)** overdue before not-overdue, **3)** nearest due date ascending, **4)** longest in current state, with order ID as the final stable tiebreaker. Also available: `priority`, `due_date`, `oldest_order`, `newest_order`, `longest_in_state`, `order_number` (numeric-aware, so `#999` sorts before `#1001`).

`priority`, `oldest_order`, `newest_order`, `longest_in_state`, and `order_number` are single indexed `ORDER BY` clauses. `due_date` and `urgency_default` need the computed nearest-due-date across a related table, so they're applied as an exact JS comparator (`compareCards`) after an approximate SQL-level fetch order — see Performance below for what this means for pagination depth.

### Filters

All server-driven (URL search params → `orders.tsx`'s loader; no client-side filtering of already-rendered cards) via `app/domain/orders/board-filters.ts`: priority, due-date state (overdue/due today/due soon/no due date — "due soon" defaults to a 3-day window, not yet configurable per shop), Shopify tags (multi-select, sourced from a distinct-tag query), preorder, no proof required, waiting on customer (`workflowStatus = WAITING_CUSTOMER` OR `proofSummary = WAITING_ON_CUSTOMER` — either flavour of "the ball is in the customer's court"), integration issue, customer response (`proofSummary = CHANGES_REQUESTED`), order age (over 7/14/30 days), assignment (anyone/me/unassigned/a specific staff member), and free-text search. Active filters render as removable chips with a "Reset all" action (`BoardFiltersBar.tsx`).

**Search** matches order number, customer name, customer email, product title, and SKU via case-insensitive `contains`; Shopify tags match by **exact** value only (Postgres array columns can't do a partial-match `ILIKE` across elements without raw SQL) — use the dedicated tag filter for substring tag matching. Not the full global search promised for a later milestone.

**To add a filter**: add the field to `boardFiltersSchema` in `board-filters.ts`, wire it into `parseBoardSearchParams`/`boardFiltersToSearchParams`, add its `Prisma.ShopifyOrderWhereInput` fragment in `buildBoardWhere` (`board-query.server.ts`), and add a control to `BoardFiltersBar.tsx`.

### Saved views

Uses the existing `SavedView` model as-is — no schema changes. `filters` (Json) stores `{ filters, view, visibleColumns, density }`; `sortOrder` (Json) stores `{ field }` separately, matching the model's own two JSON columns. Both are re-validated with zod (`savedViewFiltersColumnSchema` / `boardSortSchema`) every time they're read back, not just on write — a saved view is still user input, even the user's own.

Views are staff-specific: `listSavedViews`/`createSavedView` scope by `staffUserId`; `updateSavedView`/`deleteSavedView` check `view.staffUserId === callingStaffUserId` and return a `forbidden` outcome (not a silent success) otherwise — never a shared/team view in this milestone. Setting a new default clears `isDefault` on the staff member's other views first. Deleting the current default just leaves no row with `isDefault: true`; the board's own built-in default (`urgency_default` sort, no filters) applies — nothing throws or needs special-casing.

### Performance and pagination

- **Board card queries only select what's needed for the card** (`BOARD_CARD_SELECT` in `board-query.server.ts`) — never `rawPayload`, never unrelated relations.
- **Initial load**: one bounded query, `take: PER_COLUMN_LIMIT (40) × 7 columns = 280` rows max, regardless of how many orders actually exist — then bucketed into columns in JS using the exact same `getBoardColumnKey` function used everywhere else (zero drift risk between "which column is this in" and "how did we query for it").
- **Load more** (`/orders/column`, a separate resource route so `orders.tsx`'s own loader always returns one consistent shape): for the 5 SQL-sortable sort fields, a true cursor-paginated query scoped to just that column's `where` fragment — efficient at any depth. For `due_date`/`urgency_default` (which need the JS comparator), a bounded offset-paginated fallback capped at `MAX_OFFSET_PAGINATION_ROWS` (500) — a documented, honest limitation rather than an unbounded full-table scan.
- **Indexes**: `[shopId, workflowStatus]` and `[shopId, priority]` already existed; this milestone adds `[shopId, proofSummary]` (used by the Changes Requested/Proof Sent promotion and the customer-response/no-proof-required filters) and `[orderId]`/`[staffUserId]` on `OrderAssignment` (assignment lookups and the "assigned to me"/"unassigned" filters).
- **Distinct tags** for the tag-filter dropdown use one raw `SELECT DISTINCT unnest(tags)` query (capped at 200), not a per-order scan.

**Expected behaviour at scale**: at ~100 active orders, everything fits in the initial bounded fetch — no "load more" ever appears. At ~500, some columns likely exceed the per-column limit and show "Load more" (a real, indexed page, not a re-fetch of everything). At 1,000+, the same holds — the initial fetch stays capped at 280 rows regardless of total volume, and "load more" pagination is what carries the rest, so the board's first-paint cost doesn't grow with total order count. The one soft spot: very deep "load more" paging under `due_date`/`urgency_default` sort is offset-based and capped at 500 rows scanned — deep paging under those two sorts specifically is the one place performance could degrade before hitting the cap.

**Real-time updates across staff members are not implemented** (each staff member sees their own last-loaded state until they navigate/refetch) — this matches the architecture review's own note that Stage One can defer this, with polling floated as a Stage Two candidate. Not built here since the milestone didn't call for it explicitly.

### Card contents and honesty rules

`OrderCard.tsx` shows: order number, customer name, order date, days in current state (`workflowStatusChangedAt`, **not** `createdAt` — see below), product thumbnails (up to 4, "+N more"), Shopify tags (up to 3, "+N"), priority (colour + icon + text, never colour alone), nearest due date (type + overdue/due-today/due-soon/future/none state), assignment (or an honest "Unassigned"), proof summary (`PROOF_SUMMARY_LABELS` — "Proofs not started", "No proof required", etc., never an invented status), proof group count (only shown when > 0; correctly 0 for every order right now since proof groups don't exist yet in this milestone), and indicator badges for preorder, waiting-on-customer, changes-requested, approved-but-not-exported (`workflowStatus IN (PARTIALLY_APPROVED, READY_FOR_EXPORT)`), and integration issues (a warning icon + accessible label + severity, linking to `/integrations` for staff with `integrations.view` — never raw technical error text).

**Time in state**: uses `ShopifyOrder.workflowStatusChangedAt` (new column, this milestone), not `createdAt`. Existing orders (imported before this migration) were backfilled from `createdAt` in the migration itself — accurate, since no order had ever transitioned status before this milestone's move mechanism existed. Going forward, `moveOrderWorkflowStatus` is the only writer, so it stays accurate.

**Product images**: `ShopifyOrderLine.imageUrl` is already the resolved single image from Milestone 04 (variant → product → null); the card appends a `width` query param for Shopify CDN's own image-resizing (keeps payloads small) and falls back to a plain icon (not a broken `<img>`) when `imageUrl` is null.

### Lightweight preview (not the order drawer)

Clicking a card opens `OrderPreviewDialog.tsx` — a Radix Dialog reusing the card data already loaded for the board (no extra request). Shows order number, customer, workflow status, priority, due date, assignment, product lines, tags, and a Raw Data Inspector link (staff with `raw_data.view` only). No proof editing, communication history, or production actions — that's the full order drawer, explicitly out of scope here.

### Drag-and-drop and accessibility

`@dnd-kit/core` handles pointer/touch dragging (chosen over `react-beautiful-dnd`/forks for its accessibility-first design and active maintenance). A dedicated drag handle (not the whole card) starts a drag, so the card's other click targets (order number, Move-to menu) don't conflict with drag detection.

**Keyboard users use the "Move to…" menu** (`MoveToMenu.tsx`) instead of dnd-kit's keyboard sensor — every interactive column is listed, disallowed destinations are visibly disabled (not hidden) with a `title` explaining why, and selecting an allowed one calls the exact same `onMove` handler a completed drag would. This was a deliberate choice over wiring dnd-kit's `KeyboardSensor`: a plain accessible menu is simpler to get right and test directly against the same server action.

Other accessibility points: each column is a `<section aria-label="{label}, N orders">`; an `aria-live="polite"` region announces "Order moved." or "Move failed: {reason}" after every move attempt; drag is opt-in per card (a small handle button, not the whole card body, so normal page/column scrolling is never blocked); `prefers-reduced-motion` is already handled globally (`app.css`, Milestone 06A).

### Responsive behaviour

Columns lay out horizontally with `overflow-x-auto` on desktop/tablet; on narrow viewports the same horizontal-scroll behaviour applies (no separate mobile-only layout was built this milestone — acceptable per the milestone's own "horizontal board scrolling is acceptable" allowance) with filters remaining in normal document flow (not hover-only) so they're reachable on touch.

### Loading, empty, and error states

No orders matching filters → `EmptyState` ("No orders match your filters"). Empty individual column → its own `EmptyState` ("No orders here"). Failed move → `ErrorAlert` plus the `aria-live` announcement, and the optimistic UI change is rolled back to the last known-good server state. Permission denied → the same 403 pattern as every other route. Nothing here ever fabricates example orders, fake counts, or fake notifications.

### Manual verification fixtures

`npm run db:seed:board-demo` (`scripts/seed-board-demo.ts`) seeds 18 synthetic orders (`#9001`–`#9018`, no real customer data) covering every scenario in this milestone's manual-verification checklist — new, proof being prepared, proof sent, waiting on customer, approved, changes requested, exported for print, no proof required, preorder, urgent+overdue, unassigned, integration failure, cancelled, on hold, archived, several products, missing product image, and many tags. Idempotent (upserts on `orderNumber`) — safe to re-run. Delete with `DELETE FROM "ShopifyOrder" WHERE "orderNumber" LIKE '#90%';`.

### Deferred to later milestones

- The full order side drawer (tabs for Products, Uploads, Proofs, Communication, Internal Notes, Shopify, Activity, Raw Data per SRS 9.5) — this milestone only has the lightweight preview.
- Proof-group and proof-version creation, sending, and customer responses — until these exist, "Changes Requested"/"Proof Sent" columns and the customer-response/no-proof-required filters have no real data to show (honestly empty, not faked).
- The dedicated export action for "Exported for Print".
- A reactivation/override flow for on-hold, cancelled, or archived orders.
- Quick-assign from the board (explicitly optional per the milestone spec — skipped to keep scope focused; `OrderAssignment` display/filtering works, but there's no assign/unassign action here).
- Real-time cross-staff board sync (polling or push) — each staff member sees their own last-fetched state.
- ~~A dedicated production/warehouse/packing screen~~ — **resolved post-Milestone 16**: see the "Board-column mapping (redesigned — see ADR-0013)" update above. A dedicated "Pack" column now exists, populated automatically by warehouse handover or manually by drag, with inline freight controls.

## Full order drawer (Milestone 07)

`/orders/:orderId` (`app/routes/orders.$orderId.tsx`) is the detailed internal order workspace opened from a Kanban card — the "full order drawer" the Milestone 06B preview dialog explicitly deferred. It replaces `OrderPreviewDialog.tsx` entirely (deleted this milestone).

### Route and deep linking

`app/routes.ts` nests the drawer as a **child** of the `orders` route:

```
route("orders", "routes/orders.tsx", [
  route(":orderId", "routes/orders.$orderId.tsx"),
  route(":orderId/more", "routes/orders.$orderId.more.tsx"),
]),
```

`orders.tsx`'s component renders `<BoardPage {...loaderData} /><Outlet />` — the child route's content overlays the board via React Router's normal nested-route mechanism, not client-only modal state. This gets every deep-linking requirement for free: `/orders/:orderId` is a real URL (shareable, bookmarkable), browser back/forward works natively, a refresh re-runs both loaders and reopens the same drawer, and — because React Router only re-runs a loader whose own params changed — opening/closing the drawer never re-triggers the board's own loader, so the board stays responsive while the drawer loads.

`OrderCard.tsx` and `SpecialStatusList.tsx` link to `/orders/${card.id}` with the board's current `location.search` preserved, so closing the drawer (`Dialog`'s `onOpenChange` navigates to `{ pathname: "/orders", search: location.search }`) returns to the board with active filters intact.

### Permissions

Reused as-is: `orders.view` (gates the whole route), `notes.internal.view`/`notes.internal.create` (Milestone 03), `raw_data.view` (Milestone 05), `integrations.view` (gates technical detail on integration-issue cards, same as the rest of the app). New this milestone: `orders.assignment.update`, `orders.priority.update`, `orders.due_dates.update`. Granted to Manager and Artwork Staff alongside their existing `board.manage`; Print Staff and Packing Staff can view an order (Print Staff only) but not edit any Hub-owned field.

**No separate `orders.activity.view` permission was added.** Activity is just another view of the same order, gated by `orders.view` like every other tab — anyone who can open the drawer at all can see its activity history; a finer-grained split wasn't justified by anything in the milestone.

Every check happens server-side in the route's `loader`/`action`; the client only uses the returned `can*` flags to decide what to render (a read-only field vs. an editable one). A missing permission on the action side returns `{ ok: false, error }`, never a silent success.

### Tab architecture

`OrderDrawer.tsx` wires eight `@radix-ui/react-tabs` tabs, matching the SRS's own structure: Overview, Products, Uploads, Proofs, Communication, Notes, Shopify, Activity. Fully built: Overview, Products, Uploads, Notes, Shopify, Activity. Proofs and Communication render `PlaceholderTab.tsx` — an honest "not built yet" `EmptyState`, never a fake progress indicator or a button that looks clickable but does nothing.

Each tab is a separate component under `app/components/order-drawer/`; `OrderDrawer.tsx` itself only handles the dialog chrome (header, overflow menu, tab list) and passes the single `order: OrderDetail` object (plus permission flags) down. No tab re-fetches the order itself — `order-detail-query.server.ts`'s `loadOrderDetail` is the one place that assembles it, in a single `findFirst` with nested `include`s for lines/properties/artwork-links/due-dates/assignments/integration-failures, plus two separate bounded queries (notes, activity) run in the same `Promise.all`.

### Shopify-owned vs. Hub-owned fields, in the drawer specifically

Same split documented above for order import, surfaced explicitly in the UI: `OverviewTab.tsx` groups fields under two headed sections — "Internal workflow (Production Hub)" (editable with permission; workflow status display, priority, assignment, due dates, latest note preview) and "Order summary (from Shopify — read only)" (proof requirement, financial/fulfilment status, tags, customer note, preorder). `ShopifyTab.tsx` is entirely read-only by construction — none of its fields have an editor anywhere in the drawer. Shopify refresh (Milestone 04's `importShopifyOrder`) still only ever writes Shopify-owned columns, so nothing edited here can be silently overwritten by the next sync.

### Assignment, priority, and due-date editing (compare-and-swap)

All three editors (`update-assignment.server.ts`, `update-priority.server.ts`, `update-due-date.server.ts`) follow the exact CAS idempotency pattern established by Milestone 06B's `moveOrderWorkflowStatus`:

1. Read the current value fresh.
2. If it already equals the requested target, return `already_there` — checked **before** comparing against the client's claimed "expected" value, so an exact duplicate/retried submission is a safe no-op, not a false conflict.
3. If the current value doesn't match what the client expected, return `conflict` (someone else changed it since the client last loaded the drawer) — no write happens, and the UI shows "changed since you last saw it" rather than silently overwriting.
4. Otherwise perform the write scoped by the expected value (`updateMany`/`deleteMany` with the expected value in the `where` clause, checking `count` to catch a genuine race even after steps 1–3 passed), then write exactly one `ActivityEvent` inside the same `$transaction`.

**Assignment** edits exactly one slot: the `ARTWORK` role (`DRAWER_ASSIGNMENT_ROLE` in `order-detail-query.server.ts`) — the same "primary assignee" the board's own card already shows. `OrderAssignment` supports OWNER/ARTWORK/PACKING/PRODUCTION/GENERAL roles for future production/warehouse/packing screens, but full multi-role assignment management is explicitly out of scope here. Assigning validates the target staff member is `isActive`; clearing sets `unassignedAt` on the existing row rather than deleting it (assignment history survives).

**Priority** requires a non-empty reason for HIGH/URGENT (`PRIORITIES_REQUIRING_REASON`), recorded on a new `OrderPriorityHistory` row alongside the `ActivityEvent`. `PriorityEditor.tsx` only shows the reason field once one of those two is selected, and disables Save until it's filled in — client-side UX only; the server re-validates independently.

**Due dates** are the one case that routes through the existing `ManualOverride` model (`OverrideType.CHANGE_DUE_DATE`, discovered already in the schema for exactly this) instead of a bespoke audit row — a reason is always required (not just for certain values), and both the `ManualOverride` and the `ActivityEvent` are written in one `$transaction`. All four `DueDateType`s (Internal, Customer-promised, Production, Dispatch) are independently addable/updatable/clearable; `DueDatesEditor.tsx` shows one row per type with an inline add/change/clear form.

None of these three ever let a Shopify sync overwrite them — `importShopifyOrder`'s update payload still only touches Shopify-owned columns (see above), and priority/assignment/due dates aren't among them.

### Internal notes

`add-note.server.ts` is **create-only** this milestone — `OrderNote` has no `edited`/`deletedAt` columns yet, so editing and removal are deferred rather than built against a model that isn't ready for them (documented here as a known limitation, not silently skipped). Validates non-empty (after trim) and a 5,000-character maximum (`MAX_NOTE_LENGTH`); a duplicate exact resubmission from the same author within a 5-second window is treated as a no-op (`outcome: "duplicate"`, returns the existing note's id) rather than creating a second row — a simple double-submit guard, not a full request-id idempotency system. Notes are always `NoteVisibility.INTERNAL` and rendered as plain JSX text (React escapes it automatically) — never `dangerouslySetInnerHTML`, so no separate sanitisation step exists or is needed.

### Uploads: grouped strictly by line

`UploadsTab.tsx` never shows an order-level gallery. Each order line that has at least one `ArtworkOrderLineLink` gets its own section; within it, each linked `CustomerArtworkAsset` shows filename, MIME type, size, which line property it was parsed from (matched via `ShopifyLineProperty.parsedAssetId`, not by name-guessing), upload timestamp, storage status (`EXTERNAL_REFERENCE` vs `STORED` — there is **no checksum field** in the schema, an honest gap rather than an invented one), a parsing-uncertain flag when set, and a link to the source URL. Two lines referencing files with the same filename render as visually distinct cards (different lines, different underlying asset rows) — nothing collapses or dedupes across lines.

### Activity timeline

`ActivityTab.tsx` renders `event.summary` directly (already human-readable, written at record-creation time by whichever service created the event) rather than trying to format `eventType` — existing event-type values are an inconsistent mix of `UPPER_SNAKE` (Milestone 04's `ORDER_IMPORTED`, `ORDER_CANCELLED`) and `lower_snake` (Milestone 06B's `workflow_status_changed`, this milestone's `assignment_changed`/`priority_changed`/`due_date_changed`/`internal_note_added`) — a deliberate decision not to "fix" historical values, just never rely on the raw string for display. Opening the drawer itself never creates an `ActivityEvent` — only genuine transitions do (enforced the same way as Milestone 06B: the CAS `already_there` path never reaches the event-write code).

### Concurrency: revalidation, not just CAS

The CAS pattern above stops a *write* from silently clobbering a stale value. Getting a fresh *read* back into the UI without a full page reload needed one more piece: `NotesTab.tsx` and `ActivityTab.tsx` keep their own accumulated list state (so "load more" pagination can append to it), seeded once from `initialNotes`/`initialEvents` props. Any fetcher-based edit elsewhere in the drawer (assignment, priority, due date, or `NoteForm`'s own submission) posts to the parent route's action, which triggers React Router's default revalidation of that route's loader — producing a fresh `order` object with a new `notes`/`activity` array reference. Both tabs use the same "adjust state during render" pattern as `AssignmentEditor`/`PriorityEditor` (compare the incoming prop reference to what was last seen; if different, reset local state to it) so a newly created note or a newly recorded event appears immediately, without discarding an in-progress "load more" page the instant it's superseded by a fresher first page.

This was caught and fixed via manual browser verification, not by the automated test suite — the integration tests exercise `addOrderNote`/the route `action` directly and correctly show the note lands in the database, but none of them render the full `NotesTab` component through a revalidating fetcher loop, so the missing sync went unnoticed until clicking through the real UI. Worth remembering for the next milestone that adds a create-then-display flow inside an existing tab.

### Header, overflow menu, and integration issues

The drawer header shows order number, priority badge, an integration-issue indicator (icon + accessible label, only when `integrationIssues.length > 0`), customer name, workflow status, assignee, nearest due date (computed client-side from `order.dueDates`, same "earliest wins" logic as the board's `pickNearestDueDate`), order-created date, and last-synced timestamp. The overflow menu (`DropdownMenu`) offers "Open in Shopify" (only when both `shopDomain` and `shopifyLegacyOrderId` are available — constructing `https://{shopDomain}/admin/orders/{legacyId}`), "Open Raw Data Inspector" (only for `raw_data.view`, linking to the existing Milestone 05 `/dev/orders/:orderId` screen — no raw payload is exposed inside the drawer itself), "Copy order number", and "Copy drawer link" (`navigator.clipboard`, with a `role="status"` confirmation message).

`OverviewTab.tsx` shows full integration-issue detail (not just the header's compact indicator): summary, severity, status-derived "Action required"/"Being handled", first/latest occurrence, and — only when the loader populated it (`includeIntegrationTechnicalDetail`, itself gated on `integrations.view`) — technical detail and attempt count. `order-detail-query.server.ts` only fetches open-status failures (`OPEN_STATUSES`) at all; resolved ones remain visible in the Activity tab (as whatever event recorded the resolution) but not as an open Overview card.

### Responsive and accessibility notes

The dialog is `fixed inset-y-0 right-0`, full-width by default and constrained to `sm:w-[90vw] sm:max-w-3xl md:max-w-4xl` at wider breakpoints — the same Tailwind breakpoint pattern already used throughout the shell (Milestone 06A), not a bespoke one. The tab list scrolls horizontally (`overflow-x-auto`) rather than wrapping or shrinking tab labels on narrow viewports. Built on `@radix-ui/react-dialog` (focus trap, `Escape`-to-close, return focus to the trigger on close) and `@radix-ui/react-tabs` (roving tabindex, arrow-key navigation) — the same "use the accessible primitive, don't hand-roll it" rule as the rest of the shell. Every icon-only control has an `aria-label`; copy actions confirm via a `role="status"` message, not colour alone.

### Manual verification fixture: order `#9019`

`scripts/seed-board-demo.ts` (extended this milestone, still safe to re-run/idempotent) adds order `#9019` to the existing `#9001`–`#9018` set specifically to exercise every drawer section at once: three product lines each with several properties (including two separate `FILE_UPLOAD`-detected properties on different lines that happen to share a filename, to prove line association and filename-distinctness), a `PropertyDetectedType.UNKNOWN` property to show the "parsing uncertain" label, no customer email on file, all four due-date types set, two internal notes, a 35-event synthetic activity history (to exercise the Activity tab's "load more"), an `IntegrationFailure` with `technicalDetail` and three attempts, HIGH priority, and an assignment. Delete the whole demo set the same way as before: `DELETE FROM "ShopifyOrder" WHERE "orderNumber" LIKE '#90%';`.

### Deferred to later milestones

- Proof-group and proof-version creation, sending, and customer proof responses — the Proofs and Communication tabs are honest placeholders until these exist.
- A dedicated export-for-print action, and reactivating an on-hold/cancelled/archived order — same as Milestone 06B, still nothing has changed here.
- Quick-assign from the Kanban card itself (assignment editing lives only in the drawer this milestone).
- Real-time cross-staff updates — another staff member's edit to the same order only appears on this staff member's next load/revalidation, not pushed live.
- Note editing and removal — deferred until `OrderNote` has the columns to support them (see "Internal notes" above).
- A dedicated checksum field for uploaded artwork assets — doesn't exist in the schema; not invented here.
- Production/warehouse/packing screens — still collapsed into the board's "Exported for Print" catch-all; the drawer doesn't add anything here either.

## Proof groups and proof versions (Milestone 08)

The Proofs tab (`app/components/order-drawer/proofs/ProofsTab.tsx`) replaces Milestone 07's placeholder. This milestone is entirely internal-staff-facing: creating proof groups, uploading versioned proof files, and tracking internal readiness. **Nothing here sends anything to a customer** — see "Deferred to later milestones" below.

### Domain model

An order can have any number of `ProofGroup` rows (one order → many groups). Each group can be linked to any number of order lines and any number of `CustomerArtworkAsset` uploads, and each of those can be linked to any number of groups in turn — all three of these are genuine many-to-many relationships, modelled as their own join tables (`ProofGroupOrderLine`, `ProofGroupArtworkAsset`) rather than a foreign key on one side. A group holds any number of `ProofVersion` rows, each an immutable, permanent record — a version is never edited or overwritten, only ever superseded by a new one. `ProofRequirement` (one-to-one with a group) tracks the proof-required/not-required/undetermined decision separately from the group's own workflow `status`, because "does this need a proof at all" and "how far along is the proof" are genuinely different questions. `ProofNote` is scoped to exactly one of a group or a version (never both, enforced at the application layer, mirroring `ProofRequirement`'s existing one-FK-set convention). `ProofAsset` holds the actual uploaded-file metadata for a version; `ProofVersionSourceAsset` separately tracks which customer-supplied uploads a given version was produced *from* (distinct from `ProofGroupArtworkAsset`, which tracks assets linked at the group level regardless of which version used them).

### Requirement decisions and no-proof-required reasons

`ProofRequirement.value` defaults to `UNDETERMINED` and is **never inferred** from whether an upload or version exists — an order with three artwork uploads and zero proof groups still reads as `UNDETERMINED`, because "a file exists" and "a human decided this needs a proof" are different facts. Setting `NOT_REQUIRED` always requires a reason (`NoProofReason`: `UNPRINTED_PRODUCT`, `REPEAT_JOB_PREVIOUS_ARTWORK`, `APPROVED_STANDARD_LOGO`, `CUSTOMER_SUPPLIED_PRODUCTION_READY`, `INTERNAL_STAFF_ORDER`, `OTHER` — `OTHER` additionally requires explanatory text), recorded as a `ManualOverride` (`OverrideType.MARK_NO_PROOF_REQUIRED`, reused from Milestone 07's due-date override rather than adding a near-duplicate type) alongside the always-written `proof_requirement_changed` `ActivityEvent`. Reopening an already-`NOT_REQUIRED` group back to `REQUIRED`/`UNDETERMINED` is itself an override requiring its own reason — every requirement change, in either direction, leaves a permanent trail of who/when/previous/new/reason.

The milestone's requested three-value vocabulary (`UNDETERMINED`/`PROOF_REQUIRED`/`NO_PROOF_REQUIRED`) is mapped onto the schema's existing four-value `ProofRequirementValue` enum (`UNDETERMINED`/`REQUIRED`/`NOT_REQUIRED`/`PARTIALLY_REQUIRED`) rather than renamed — see the decision log entry for 2026-07-28. `PARTIALLY_REQUIRED` is reachable in the schema but no code path sets it this milestone; it's reserved for a later milestone where a single group might genuinely span lines with different requirement outcomes.

### Linking rules

Linking an order line or asset to a group never removes any other association: a line can belong to several proof groups at once (e.g. one line needing both an embroidery proof and a separate screen-print proof), a group can hold several lines (e.g. three garment lines sharing one left-chest logo), and a customer-uploaded asset stays linked to its original order line (`ArtworkOrderLineLink`, from Milestone 04) regardless of how many proof groups also link to it. Unlinking a line or asset from a group hard-deletes only the join row — the group, the line, and the underlying asset are all untouched; history of the unlink itself is preserved as an `ActivityEvent`, not by keeping the join row around. Linking validates the line belongs to the *same order* as the group and the asset belongs to the *same shop* — cross-order/cross-shop links are rejected outright, and a duplicate link request is treated as an idempotent no-op (`outcome: "already_there"`), not an error.

### File storage and internal preview

Proof files are validated by magic-byte signature only (`app/domain/proofs/file-validation.ts`) — the browser-supplied MIME type and filename are never trusted for validation, only preserved for display (`sanitizeDisplayFilename` strips path separators and control characters, keeps ordinary spaces). Supported types: PNG, JPEG, PDF; max 25 MB. Storage keys are always server-generated (`proof-versions/${proofGroupId}/${randomUUID()}.${ext}`), never derived from user input, which rules out path traversal by construction rather than by sanitizing an untrusted key. Files are stored via the `StorageAdapter` interface (`app/adapters/storage/storage-adapter.server.ts`), currently backed by a real local-disk implementation (`localDiskStorageAdapter`) rather than Cloudflare R2 — see [ADR-0004](decisions/0004-interim-local-disk-proof-storage.md) for why, and its production-readiness implications. `putObject` refuses to overwrite an existing key. If a proof-version's database transaction fails after the file was already written, the orphaned storage object is deleted as a best-effort cleanup — it is never left dangling, but it is also never relied upon as the only cleanup path (a future storage-lifecycle sweep is not implemented and not needed yet at this scale). Internal preview (`/proof-assets/:assetId`, `app/routes/proof-assets.$assetId.tsx`) streams the bytes directly through the Node process, authorization-scoped through `proofVersion.proofGroup.order.shopId`, gated on `proof_versions.view`.

### Version numbering, supersession, and idempotency

Each new version within a group gets the next sequential `versionNumber`, computed and inserted inside a single `$transaction`, with the pre-existing `@@unique([proofGroupId, versionNumber])` database constraint as the actual race-detector — a `P2002` violation triggers an application-level retry (`createVersionWithRetry`, up to 5 attempts) rather than relying on a lock the database doesn't otherwise need. Verified correct under genuine concurrency: an integration test fires two `createProofVersion` calls at once via `Promise.all` and asserts they land as versions 1 and 2, never a duplicate. Creating a new version always immediately supersedes any prior `DRAFT`/`READY_TO_SEND` version in the same group (`status: SUPERSEDED`, `supersededByVersionId` set, its own `proof_version_superseded` event) — a group's most recent non-superseded, non-cancelled version is always its one "current" version by construction. A client-supplied `idempotencyKey` lets a retried upload (e.g. a flaky network resubmission) return the existing version (`outcome: "duplicate"`) instead of creating a second one; this check happens *before* any storage write, so a retry never leaves an orphaned file behind either.

**No proof version or proof file is ever overwritten in place, and no version is ever deleted** — cancellation (`cancelProofVersion`) sets `status: CANCELLED` with a required reason, and supersession sets `status: SUPERSEDED`; both preserve the row and its underlying stored file permanently.

### Status state machines (this milestone's reachable subset only)

`ProofGroupStatus` and `ProofVersionStatus` both carry SRS-reserved values for later milestones (`SENT`, `VIEWED`, `CHANGES_REQUESTED`, `APPROVED`, `READY_FOR_EXPORT`, `EXPORTED_FOR_PRINT` on groups; `SENT`, `VIEWED`, `APPROVED`, `CHANGES_REQUESTED` on versions) that **no code path in this milestone sets**. Every server action's input type is restricted to an `ActiveProofGroupStatus`/`ActiveProofVersionStatus` union (`app/domain/proofs/labels.ts`) covering only the values this milestone actually uses — attempting to set a later-milestone status is a compile-time type error, not just a runtime guard:

- **Group:** `NOT_STARTED` → `DRAFT_IN_PROGRESS` (first version created) → `READY_TO_SEND` (latest version passes readiness validation) → `CANCELLED` (terminal, any point, reason required); separately, `NOT_STARTED`/`DRAFT_IN_PROGRESS`/`READY_TO_SEND` ⇄ `NO_PROOF_REQUIRED` via the requirement-decision flow above.
- **Version:** `DRAFT` (on creation) → `READY_TO_SEND` (passes readiness) or `CANCELLED` (reason required); any `DRAFT`/`READY_TO_SEND` version is superseded to `SUPERSEDED` the moment a newer version is created in the same group.

Cancelling a group's only usable version reverts the group to `NOT_STARTED` rather than resurrecting an earlier, already-superseded version — a group with a cancelled current version has, honestly, no usable version, and the UI should say so rather than silently point at stale artwork.

### Readiness validation

`validateProofGroupReadiness` (`app/domain/proofs/readiness.ts`) is pure and returns *every* failing check at once, not just the first: the requirement must be `REQUIRED`, at least one line must be linked, a current (non-cancelled, non-superseded) version must exist with a stored file, the group needs a non-empty name, a `placement` is required unless the decoration method is `UNPRINTED`, and there must be no open `IntegrationFailure` referencing the group. `markProofVersionReady` calls this before allowing the `READY_TO_SEND` transition and returns the full `issues` array on rejection; the same computed `readiness` object is included on every group the drawer loads, driving the collapsed-card warning icon.

### Order-level proof summary

`ShopifyOrder.proofSummary` is never hand-set — it's recalculated (`recalculateOrderProofSummary`, inside the same transaction as every other proof mutation) from the live state of the order's non-cancelled proof groups via a pure cascade (`calculateOrderProofSummary`, `app/domain/proofs/order-proof-summary.ts`): no groups → `PROOFS_NOT_STARTED`; all groups `NO_PROOF_REQUIRED` → `NO_PROOFS_REQUIRED`; any required group blocked by an open integration failure → `BLOCKED`; every required group's version `READY_TO_SEND` → `READY_TO_SEND`; any required group has a version at all → `PROOFS_IN_PROGRESS`; otherwise → `PROOFS_NOT_STARTED`. Only `READY_TO_SEND` and `BLOCKED` were genuinely new enum values this milestone — `PROOFS_NOT_STARTED` is reused for both the "undetermined" and "no proofs created yet" concepts rather than introducing a near-duplicate value (decision log, 2026-07-28). The Kanban board's card-level proof summary (`app/domain/proofs/board-summary.ts`) is a separate, purely presentational rollup (ready/in-progress/no-proof-required/blocked counts, latest thumbnail, assigned-staff names) computed the same batched way as the rest of the board query — it does not replace or duplicate the order-level `proofSummary` column.

### Permissions

New this milestone, granted identically to Manager and Artwork Staff (matching Milestone 07's precedent that both roles get the same drawer-editing permissions): `proof_groups.view/create/update/cancel/requirement.update`, `proof_versions.view/create/upload/status.update`, `proof_artwork.assign/notes.create`, `proof_overrides.create`. Print Staff gets `proof_groups.view`/`proof_versions.view` only (read-only); Packing Staff gets none. Every check happens server-side in `orders.$orderId.proof-groups.tsx`'s `action` (per-intent, before delegating to the matching domain function) — a missing permission returns `{ ok: false, error }`, never a silent success, and hiding a control client-side is never treated as a substitute for the server check.

### Concurrency and idempotency

Every mutating action follows the same compare-and-swap pattern established in Milestones 06B/07: check "already there" before comparing against the client's claimed "expected" value (so an exact duplicate resubmission is a safe no-op, not a false conflict), a scoped `updateMany`/`deleteMany` with a `count` check to catch a genuine race, then one `ActivityEvent` write in the same transaction. `updateProofGroup` and `setProofRequirement` use `expectedUpdatedAt`/`expectedRequirement` as their optimistic-concurrency token; `assignProofGroup` uses `expectedStaffUserId`. Version creation additionally has its own concurrency story (version-numbering above) beyond plain CAS, since it's an insert racing against other inserts rather than an update racing against other updates.

### Audit and activity history

Every meaningful action writes an `ActivityEvent`: group created/updated/cancelled, requirement changed, line/asset linked/unlinked, group assigned, version created, file uploaded (a *separate* event from version-created, per the milestone's explicit list), version superseded, version marked ready, version cancelled, note added. `ActivityTab.tsx` (Milestone 07) already renders these — no drawer changes were needed there, since it renders whatever `event.summary` the writing service already produced, the same "don't try to reformat a human-readable string" approach as every other milestone's events.

### How this extends into later, customer-facing milestones

This milestone deliberately stops at `READY_TO_SEND` — a proof version a staff member has validated and would be prepared to send. The later customer-proofing milestone the SRS describes builds on top of, without needing schema changes to what's here: the reserved `SENT`/`VIEWED`/`APPROVED`/`CHANGES_REQUESTED` status values, the customer proof portal, actual email delivery (Klaviyo), and change-request handling all read and write the same `ProofGroup`/`ProofVersion` rows this milestone created. `PARTIALLY_REQUIRED` and `ProofGroupStatus.READY_FOR_EXPORT`/`EXPORTED_FOR_PRINT` are similarly reserved rather than invented fresh when that work starts.

### Manual verification fixture: order `#9020`

`scripts/seed-board-demo.ts` (extended this milestone, still idempotent) adds order `#9020` with seven proof groups exercising every scenario at once: several lines sharing one group and one line spanning two groups; two different artwork staff assigned to different groups on the same order; an overdue due date; a `NO_PROOF_REQUIRED` group for each of several reasons; an `UNPRINTED` group with no placement; a group left at the honest `UNDETERMINED` default with zero versions; a version superseded by a second, later version that gets marked `READY_TO_SEND`; a group deliberately left `BLOCKED` via a synthetic `IntegrationFailure`; and both a cancelled version and a cancelled group (demonstrating neither is ever hard-deleted). This drives the order's own `proofSummary` to `BLOCKED` — the correct outcome given one of its required groups has an open integration failure. Delete the whole demo set the same way as the rest of `#9001`–`#9020`: `DELETE FROM "ShopifyOrder" WHERE "orderNumber" LIKE '#90%';`.

### Deferred to later milestones

- Sending a proof to a customer, the customer-facing proof portal, customer approval/change-request handling, and customer-marked-up files — none of this exists yet; nothing here fabricates a customer action or a fake approval record.
- Proof reminder emails and any customer-facing communication about proofs.
- A dedicated production-artwork export action, marking a version "exported for print," and the production/warehouse/packing screens downstream of it.
- Starshipit, returns, and reprints (the `Reprint` relation on `ProofGroup` exists in the schema for a later milestone; nothing writes to it yet).
- Real-time cross-staff sync — same limitation as the board and drawer; another staff member's change to the same proof group appears only on this staff member's next load/revalidation.
- General note editing/removal for `ProofNote`, matching `OrderNote`'s existing same limitation (see Milestone 07 above).

## Customer proof portal and responses (Milestone 09)

Milestone 08 built proof groups/versions but never let anything reach a customer. This milestone wires the actual send → customer review → approve/request-changes loop, entirely within the boundary the milestone set: no export-for-print, no production/warehouse/packing, no returns, and no customer-account extension.

### Domain model — ProofRequest and ProofRequestGroup

A `ProofRequest` is one customer communication event: it holds the secure token, the customer email/name snapshot at send time, staff message, and lifecycle timestamps (`sentAt`, `firstViewedAt`/`lastViewedAt`/`viewCount`, `revokedAt`/`revokedReason`, `completedAt`). A `ProofRequestGroup` is a join row recording the **exact** `proofGroupId` + `proofVersionId` bundled into that request — never re-derived from "whatever the group's current version is now," so history stays accurate even after a later version supersedes the one actually shown to the customer. `ProofRequestStatus` is `SENT | VIEWED | PARTIALLY_RESPONDED | COMPLETED | REVOKED | SUPERSEDED` — deliberately no stored `EXPIRED` value; expiry is a comparison against `tokenExpiresAt` done at resolve-time, not a status a background job could fail to flip. See [ADR-0005](decisions/0005-proof-request-bundling.md) for why this bundling model replaced Milestone 08's originally-reserved per-`ProofVersion` token fields.

`CustomerProofResponse` (one per group per request, enforced by its `idempotencyKey` unique constraint) records the response type, customer note, change categories, request IP/user-agent, and — for an approval — which version of the approval acknowledgement wording (`PROOF_APPROVAL_ACKNOWLEDGEMENT_VERSION` in `app/domain/proofs/labels.ts`) the customer actually agreed to. `CustomerResponseAsset` holds any marked-up files, with the same metadata (`originalFilename`/`mimeType`/`sizeBytes`/`checksum`) `ProofAsset` already carries — a deliberately separate model and storage-key prefix (`customer-responses/…` vs `proof-versions/…`) so a customer mark-up is never reachable, previewable, or storable through the same path as an internal proof file.

### Secure token design

`app/auth/proof-token.server.ts` is the one place tokens are generated, hashed, and resolved:

- `generateProofToken()` — `randomBytes(32).toString("base64url")`, 256 bits of entropy, never derived from any database identifier.
- `hashProofToken(rawToken)` — plain `sha256` hex digest. `ProofRequest.tokenHash` is the only thing ever persisted; the raw token is returned to the caller exactly once, at creation (`sendProofRequest`'s "sent" result), and is never logged, never re-derivable from stored data, and never re-exposed by any other function.
- `resolveProofRequestByToken(rawToken)` — hashes the incoming token and looks it up via the database's own indexed equality match on `tokenHash`. No manual byte-by-byte comparison happens anywhere in this codebase for proof tokens, so there's no naive timing side-channel to guard against with `timingSafeEqual` here (unlike the webhook HMAC check, which compares a MAC against attacker-supplied bytes directly in application code). Returns a discriminated result (`valid | not_found | revoked | expired`) — never throws for an invalid link, since that's an expected, common outcome for a public endpoint.
- `computeProofTokenExpiry()` — `now + PROOF_TOKEN_EXPIRY_DAYS` (env var, default **14 days**, documented in `.env.example`).

Tokens are scoped to exactly one `ProofRequest` (never grant staff access, never expose another order, never expose the Raw Data Inspector — the public routes don't go through `requireStaffUser`/RBAC at all, they're gated purely by token possession). The one place the raw token is deliberately persisted a second time is `KlaviyoDispatch.eventProperties.review_proof_button` (the full customer-facing URL, needed so **resend** can re-deliver the exact same link without ever re-deriving or re-exposing the token elsewhere) — see "Resend, retry, and supersession" below and the technical-debt entry for the tradeoff this accepts.

### Customer-facing routes

Three public routes, declared as siblings of the webhook routes in `app/routes.ts`, **outside** `layout("routes/app.tsx", ...)` — they never run through `requireStaffUser` or render inside the authenticated shell:

- `GET /proof/:token` (`app/routes/proof.$token.tsx`) — the portal page. The loader **only ever reads**: it resolves the token and, if valid, loads a customer-safe projection (`app/domain/proofs/proof-portal-query.server.ts`) with no internal notes, due dates, priority, staff assignment, integration failures, Shopify raw data, activity history, or any other proof request. It never records a view.
- `POST /proof/:token/respond` (`app/routes/proof.$token.respond.tsx`) — one action-only resource route handling three `_intent` values (`view`, `approve`, `requestChanges`), matching the internal drawer's own one-route-many-intents convention. React Router only ever invokes a route's `action` export for POST/PUT/PATCH/DELETE — a GET is routed to `loader` instead, which this module doesn't wire to any mutation at all, so **a GET can never approve, reject, or record a view** by construction, not just by convention.
- `GET /proof/:token/asset/:assetId` (`app/routes/proof.$token.asset.$assetId.tsx`) — streams a proof-version's image/PDF bytes, scoped to versions that were genuinely part of this exact request's groups and were actually sent at some point (`requestLinks: { some: {} }`) — never any other version, group, order, or request, and never a still-internal draft.

`headers()` on `proof.$token.tsx` sets `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, and a same-origin-only Content-Security-Policy (`default-src 'self'`, no third-party scripts of any kind).

### View tracking — a client event, never the GET itself

`recordProofView` (`app/domain/proofs/record-proof-view.server.ts`) is called from the portal component's `useEffect` on mount, via a `POST .../respond` with `_intent: "view"` — **not** from the loader. A mail-security scanner that pre-fetches the link only ever issues a GET and never executes page JavaScript, so it cannot register a view under this design. The function is cheap to call repeatedly: only the *first* call transitions any `SENT` group/version to `VIEWED` and writes an `ActivityEvent`; every later call just bumps `lastViewedAt`/`viewCount`, so reopening the same link ten times produces one activity row, not ten.

### Sending: validation, transaction, and delivery

`sendProofRequest` (`app/domain/proofs/send-proof-request.server.ts`) validates, all at once and reported together (never partially-silent): order exists/not cancelled, usable customer email, every selected group exists on this order, is `REQUIRED`, has a linked line, isn't blocked by an open integration failure, and has a current version that's `READY_TO_SEND` with an uploaded file. One transaction then: creates `ProofRequest` + `ProofRequestGroup` rows, CAS-transitions every selected group/version `READY_TO_SEND → SENT` (rolling back the whole send if a concurrent action already moved one), writes a `proof_request_created` event plus one `proof_group_sent` event per group, queues a `KlaviyoDispatch` row, recalculates the order proof summary, and schedules the one automatic reminder. The Klaviyo delivery attempt itself happens **after** the transaction commits (no network calls inside a DB transaction) — a delivery failure is recorded on the dispatch/integration-failure rows but never rolls back the send, which has already genuinely happened from this app's side.

### Approval and change-request

`recordCustomerProofResponse` (`app/domain/proofs/record-customer-proof-response.server.ts`) is the single entry point for both. Order of checks: idempotency-key lookup first (a genuine resubmission returns `duplicate` immediately, no transaction needed) → resolve token → confirm the group is actually part of this request → confirm its linked version is still `SENT`/`VIEWED` (anything else — `APPROVED`, `CHANGES_REQUESTED`, `SUPERSEDED`, `CANCELLED` — is rejected as "no longer awaiting your response," which is exactly how an obsolete/already-resolved version is refused). Approval additionally requires `acknowledgedApproval === true` (the confirmation checkbox — page-open or link-click never counts). A change request requires written feedback or at least one uploaded file. Any file is validated by magic bytes (reusing `file-validation.ts` unchanged), stored under `customer-responses/${responseId}/…`, with checksum/original-filename/mimetype recorded.

The actual state transition is a scoped `updateMany` on the version (`WHERE id = ? AND status IN (SENT, VIEWED)`) — this is the real concurrency guard: two racing submissions (approve vs. change-request, or two duplicate approvals) can't both win, because Postgres serializes the two transactions on that row and the loser's `updateMany` matches zero rows, converted to a clean rejection rather than a corrupted double-response. Only after that CAS succeeds is the `CustomerProofResponse` row created (with its own `idempotencyKey` unique constraint as a second, independent duplicate guard for the exact-same-request-retried case). Approving or rejecting one group **never** touches a sibling group in the same request — each group's version-status CAS and response row are entirely independent.

Change-request responses additionally write a `Notification` for the group's assigned artwork staff member (skipped, not fabricated, if the group has no assignee) — but deliberately **do not** create the next proof version automatically; that remains a deliberate action by artwork staff in the existing Milestone 08 workflow.

### Reopening an approved version — manual override

`APPROVED` is a locked, terminal status once a customer response lands. `createProofVersion` (extended this milestone) still allows a new version to supersede one that's `SENT`/`VIEWED`/`CHANGES_REQUESTED` unconditionally (an ordinary next step), but superseding an `APPROVED` version requires a non-empty `overrideReason`, checked both before any storage write and again, re-authoritatively, inside the version-creation transaction (closing the race where a concurrent approval lands between the two checks). A successful override writes a `ManualOverride` row (`OverrideType.REOPEN_APPROVED_PROOF`) alongside the usual supersession `ActivityEvent`. The drawer's version-history UI only shows the "upload new version" form without an override-reason field when the current version isn't approved; once it is, the form requires the reason (and is hidden entirely from staff lacking `proof_responses.override`).

### Partial responses and request completion

A `ProofRequest` bundling several groups tracks completion as a derived fact, not a manually-set flag: after every response, the domain function checks every `ProofRequestGroup`'s linked version status across the whole request — if **all** have reached a terminal response (`APPROVED` or `CHANGES_REQUESTED` both count as "resolved," since a change request is still a genuine customer decision, just not an approval), the request becomes `COMPLETED`; if **some but not all** have, it's `PARTIALLY_RESPONDED`. One group requesting changes never blocks another group in the same request from being approved.

### Resend, retry, and supersession

Three distinct actions, deliberately not conflated:

- **Resend** (`resendProofRequest`) reuses the *same* `ProofRequest` and the *same* token — it never creates a new request row. Since the raw token is never re-derivable from the stored hash, resend copies forward the exact `eventProperties` (including the already-correct review URL) from the request's original `KlaviyoDispatch` row into a **new** dispatch attempt with a fresh `idempotencyKey`, rather than needing the raw token again. Rejected if the request is revoked, completed, or expired — resend is for "the email might not have arrived," not a way to circumvent expiry/revocation.
- **Retry** (`retryFailedKlaviyoDispatch`) re-attempts the *same* `KlaviyoDispatch` row that previously failed (reset `FAILED → QUEUED`, then dispatched again) — for genuine delivery failures, distinct from resend's "create a new delivery attempt" semantics.
- **Supersession** happens implicitly: when staff create a new proof version for a group that's currently `SENT`/`VIEWED` (see "Reopening" above, minus the override requirement for non-approved statuses), the *old* version's status flips away from `SENT`/`VIEWED`, which is exactly the condition `recordCustomerProofResponse` checks — an old, still-open customer link for that group silently becomes non-actionable ("no longer awaiting your response... a newer version may now be available") without deleting anything. The customer portal's own query similarly reports a group as `"SUPERSEDED"` in this case.

### Revocation and expiry

`revokeProofRequest` requires a non-empty reason, records actor/timestamp, and only ever blocks *future* access to the token — it never changes `ProofGroup`/`ProofVersion` status (the group is still, honestly, "sent, awaiting a response" internally) and never undoes a `CustomerProofResponse` already recorded. The request row is never deleted. Expiry (`tokenExpiresAt`) is likewise never treated as license to delete anything — `resolveProofRequestByToken` just refuses to resolve it, and the customer sees a generic "this link is no longer valid" message that doesn't distinguish "not_found" from a still-existing-but-truly-random guess, though it *does* distinguish `expired`/`revoked` from `not_found` for the honest cases where the request genuinely exists.

### Email delivery — Klaviyo, not a generic transactional-email adapter

`app/adapters/klaviyo/klaviyo-client.server.ts` is a small, dependency-free client (`upsertKlaviyoProfile`, `trackKlaviyoEvent`) — not a generic multi-provider email abstraction, because Klaviyo's profile+event model doesn't map onto queued/sending/delivered/bounced the way a transactional-email API does (see the existing architecture-review decision that customer email is Klaviyo profile-upsert + custom-event-tracking, with the actual send owned by a Flow built in the Klaviyo UI, not by this app). `app/domain/proofs/dispatch-klaviyo-event.server.ts` is the one place that writes/updates `KlaviyoDispatch` rows and folds failures into the existing `IntegrationFailure`/`IntegrationAttempt` mechanism (`integration: EMAIL`), with the same exponential-backoff retry classification already established for Shopify integration failures — a permanently-invalid request (any 4xx other than 429) is never retried indefinitely; network errors, 5xx, and 429 are. **Only the HTTP status is ever recorded in `technicalDetail`** — never the request body, so a customer email address or a proof-review URL (which embeds the token) never reaches an `IntegrationFailure` row or a log line.

Note for local development: without a real `KLAVIYO_API_KEY`, every dispatch attempt genuinely fails (a real network call to Klaviyo's API, rejected). This is expected, not a bug — the seed script's own comments call this out, and it doubles as an honest demonstration of the "email delivery failure" scenario rather than something faked separately.

### The one automatic reminder

`scheduleProofReminder` is called once, inside `sendProofRequest`'s own transaction — the `@@unique([proofRequestId])` constraint on `ProofReminder` is what actually *guarantees* "at most one reminder per request," not application logic alone. `scheduledFor` defaults to `now + PROOF_REMINDER_DELAY_DAYS` (env var, default **3 days**). `dispatchDueProofReminders` (polled every 30s alongside the existing Shopify sync-job drain in `app/lib/job-poller.server.ts`) picks up due, unsent, unsuppressed reminders and — for each — silently skips (no DB write at all) if the request is completed, revoked, expired, the order is cancelled, or every included group has already reached a terminal response; otherwise it creates a new `PROOF_REMINDER`-type `KlaviyoDispatch` (reusing the original review URL, same as resend) and marks the reminder sent inside one transaction, so a second concurrent poller tick or a same-tick staff suppression attempt loses the race cleanly (`ReminderAlreadyResolvedError`, caught and treated as a silent skip). `suppressProofReminder` requires a reason and only succeeds before the reminder has been sent; it never revokes the request itself.

"Cancelled" isn't a separate stored reminder state — a reminder that becomes moot before it's due is just silently skipped by the poller each tick it's checked, deriving "is this still eligible" from the request/order's own live status rather than duplicating that fact onto the reminder row (see the technical-debt entry on this tradeoff).

### Order-level proof summary — new customer states

`calculateOrderProofSummary` (`app/domain/proofs/order-proof-summary.ts`) gained three new boolean inputs (`isWaitingOnCustomer`, `isApproved`, `isChangesRequested`, each derived from a group's live status) and a precedence cascade, evaluated in this order: `BLOCKED` (integration failure) → `CHANGES_REQUESTED` (any required group awaiting-changes — reported distinctly from `BLOCKED`, since whose action is needed next differs) → `ALL_REQUIRED_PROOFS_APPROVED` → `PARTIALLY_APPROVED` (some but not all approved) → `READY_TO_SEND` → `WAITING_ON_CUSTOMER` (sent/viewed, no response yet) → `PROOFS_IN_PROGRESS` → `PROOFS_NOT_STARTED`. As before, this is never hand-set — `recalculateOrderProofSummary` is called at the end of every proof-domain mutation, inside the same transaction, and is a no-op if the recalculated value already matches what's stored.

### Kanban integration

`isWaitingOnCustomer`/`hasCustomerResponseAlert`/`isApprovedNotExported` on `BoardCard` were reserved fields from Milestones 06B/07, computed from `proofSummary`/`workflowStatus` but structurally unreachable before this milestone — they now become genuinely meaningful without any change to that computation. New this milestone: `hasFailedProofDelivery`, computed the same batched, no-N+1 way as the existing blocked-proof-group indicator (`loadFailedDeliveryOrderIds` — one query per board load, `IntegrationFailure` rows scoped by `relatedOrderId`+`integration: EMAIL`, not per-card). The board never loads full proof-request or response histories — only these small pre-computed booleans/counts, and customer comments are never shown on a card (only in the drawer, behind `proof_responses.view`).

### Permissions

`proof_requests.create/view/resend/revoke`, `proof_responses.view/override`, `proof_reminders.manage` — granted identically to Manager and Artwork Staff (matching every prior milestone's precedent), view-only (`proof_requests.view`/`proof_responses.view`) to Print Staff, nothing to Packing Staff. The customer portal itself is gated purely by token possession — it never consults `StaffUser`/`Role`/RBAC at all.

### Security summary

Cryptographically secure tokens (256-bit), hashed at rest, expiring, revocable; every internal mutation checked server-side (hiding a button is never the enforcement boundary); `noindex`/`no-store`/`no-referrer`/same-origin-only CSP on every public page; no third-party scripts; uploads validated by content, not extension or claimed MIME type; storage keys always server-generated; authorization on every asset-preview route scoped to the exact request/version relationship, not the raw ID alone; rate limiting is intentionally out of scope this milestone (see technical debt) — see [ADR-0005](decisions/0005-proof-request-bundling.md) for the schema-level threat-model reasoning.

### Deferred to later milestones

- Export-for-print (the Kanban board's tag-driven column handles this — see the Kanban redesign notes below), warehouse picking, packing, Starshipit, returns.
- A full customer-account proof-history page / Shopify Customer Account Extension (the SRS's own "recommended initial release uses secure tokenised proof pages" note; the account extension is explicitly a later addition).
- Real-time cross-staff synchronisation — same limitation as the board and drawer.
- Quick-assign from Kanban, general note editing/removal.
- On-hold/cancelled/archived order reactivation.
- Repeated/multi-step automated reminder sequences — this milestone is one reminder, ever, per request; additional reminders remain a manual staff action.

## Starshipit freight labels (Milestone 12)

This milestone adds a staff-triggered action that calls the real Starshipit API to create a shipment, print a label, and return a tracking number — then writes that tracking number back to Shopify. It is also the **first Shopify write** this app has ever made; every prior milestone only ever read from Shopify. Deliberately narrow, per the user's own scoping decisions: no packing gate, no warehouse/picking model, no label voiding, no customer shipping notifications, no returns/reprint-claim handling.

### No packing gate — staff are trusted to trigger this once packed

There is no `Packing`/`Fulfillment` model. `app/domain/freight/freight-eligibility.ts`'s `evaluateFreightShipmentEligibility` (pure) checks only: the order isn't cancelled, and no existing active (`PREPARING`/`CREATED`) shipment already exists for the order. "Create freight label" is available in the order drawer once the order reaches Pack, gated only by the `freight_shipments.create` permission — staff are trusted to click it once the order is genuinely, physically packed (an earlier `productionSummary === "COMPLETE"` gate was removed along with Production Artwork/Jobs — see [ADR-0014](decisions/0014-remove-production-artwork-and-jobs.md)). See [ADR-0008](decisions/0008-starshipit-freight-integration.md) for the full reasoning.

### `FreightShipment` — reserve-then-finalise, reusing Milestone 10's own shape

`FreightShipment` (`FreightShipmentStatus`: `PREPARING`/`CREATED`/`FAILED`/`CANCELLED`) follows a reserve-then-finalise three-phase pattern. `app/domain/freight/create-freight-shipment.server.ts`'s `createFreightShipment`: (1) an early idempotency-key lookup returns the existing row on a duplicate submission; reserves a `PREPARING` row (carrier code, service code, optional packaging preset, all staff-entered free text) before any external I/O; (2) calls the real Starshipit API — `app/adapters/starshipit/starshipit-client.server.ts`'s `createStarshipitOrder` then `printStarshipitLabel` — entirely outside any DB transaction, decodes the returned base64 label PDF, stores it via the existing `StorageAdapter` (`freight-shipments/:orderId/:uuid.pdf`), and computes its checksum; any failure here CAS-updates the row straight to `FAILED` with a reason (`failFreightShipment`) and returns a rejected outcome — order state is never touched; (3) a CAS `updateMany` (`where: {id, status: "PREPARING"}`) finalisation update writes the tracking number, carrier name, and label storage key, then an `ActivityEvent`. There is no `@@unique([orderId])` — an order could in principle have more than one shipment (a split shipment) — "at most one active shipment" is an application-level rule enforced inside eligibility, not a hard DB constraint. `app/domain/freight/parse-shipping-address.ts`'s `buildStarshipitDestination` validates the order's Shopify shipping address has everything Starshipit's destination object needs (street/city/postcode/country) before any API call is attempted, falling back to the order's customer name when the address itself has none.

### Carrier, service level, and packaging preset are free text

Starshipit's public API reference has no confirmed discovery endpoint for an account's actual configured carriers, service levels, or parcel presets — these are account-specific and already configured on Starshipit's own side. Staff enter `carrierCode`/`carrierServiceCode` (both required; the UI defaults the service field to "Standard" per the user's own confirmation) and an optional `packagingPresetName` — omitting it lets Starshipit apply its own account default parcel size. Starshipit's own API is the validator for an invalid combination, not a client-side guess (technical-debt item 31).

### The Shopify write-back — a separate, independently-failable step

`app/domain/freight/sync-tracking-to-shopify.server.ts`'s `syncFreightTrackingToShopify` is the app's first-ever Shopify GraphQL **mutation**, and deliberately never runs inside the same transaction or success path as shipment creation — a downstream Shopify failure must never undo a shipment that already genuinely happened with the carrier, the same principle as Milestone 11's own export→job-creation precedent. It's a two-step call: query `order(id).fulfillmentOrders.nodes{id, status}` for an `OPEN` fulfillment order, then `fulfillmentCreate(fulfillment: {trackingInfo: {number, company, url}, notifyCustomer: false, lineItemsByFulfillmentOrder: [{fulfillmentOrderId}]})`. On success, a transaction sets `FreightShipment.shopifyFulfillmentId` and advances `ShopifyOrder.workflowStatus` to `FULFILLED` (an enum value reserved since the Milestone 06B board-column work, unreachable until now) together, then calls `recordIntegrationSuccessAfterFailure`. On any failure — no open fulfillment order, Shopify `userErrors`, a thrown `ShopifyGraphQLError`, or any other unexpected error — it records via the **pre-existing** `IntegrationFailure`/`IntegrationType.STARSHIPIT` mechanism (reserved in the schema since Milestone 02) with action `"freight_tracking_sync"`, and never throws under normal operation. This means the existing `/integrations` queue and header badge (`IntegrationIssueIndicator`) pick up freight sync failures automatically — zero new UI, since both already query by the shared `IntegrationType`/`OPEN_STATUSES` contract. A staff "Retry Shopify sync" action in the drawer re-invokes the same function for a `CREATED` shipment whose `shopifyFulfillmentId` is still null. `notifyCustomer: false` is deliberate and permanent — customer shipping notifications are explicitly out of scope, the same exclusion carried since Milestones 09–11.

### Cancellation is internal-only

`app/domain/freight/cancel-freight-shipment.server.ts`'s `cancelFreightShipment` is a record-correction only (`status → CANCELLED`, requires a non-blank reason, CAS-updates from `PREPARING`/`CREATED`/`FAILED`) and never calls a Starshipit void/cancel API — no such endpoint is confirmed in the public reference this milestone (technical-debt item 29). Voiding the actual label with the carrier remains a manual process outside the Hub.

### Routes, drawer UI, and Kanban integration

`orders/:orderId/freight` (`app/routes/orders.$orderId.freight.tsx`) is an action-only resource route, one-route-many-intents (`createFreightShipment`, `cancelFreightShipment`, `retryShopifySync`). `freight-shipments/:freightShipmentId/label` (`app/routes/freight-shipments.$freightShipmentId.label.tsx`) is the label download route (permission check, `Content-Type: application/pdf`, `Content-Disposition: attachment`, informational download-count increment). The order drawer gained a "Freight" tab (`FreightTab`/`FreightShipmentSection`) showing existing shipment(s) — status, carrier, tracking number/link, label download, Shopify-sync status and retry — and a create form shown only when the order is eligible. The Kanban board gained two new batched, no-N+1 `BoardCard` fields (`hasActiveFreightShipment`, `freightTrackingNumber`, from one indexed query per board load), rendered as a "Freight label created" indicator chip. (Post-redesign — see the Kanban board section's "board-column mapping" update: `FULFILLED` now has its own special view rather than sitting inside a catch-all, and a dedicated "Pack" column exists with inline freight controls — `hasActiveFreightShipment`/`freightTrackingNumber` stay in place for the indicator chip, and `BoardCard.freightShipment` was added alongside them carrying the full shape the Pack card needs.)

### Permissions

`freight_shipments.view/create/download/cancel` — granted in full to Manager. Packing Staff (this role's first real capability) get `view` + `download` only — shipment creation and cancellation stay Manager-only until real usage patterns justify widening it. Artwork Staff and Print Staff get nothing (freight is out of their scope).

### Testing this without real Starshipit/Shopify traffic

`vitest.config.ts`'s `test.env` block supplies deterministic-but-fake `STARSHIPIT_API_KEY`/`STARSHIPIT_SUBSCRIPTION_KEY` for every test run (the same mechanism already documented for Klaviyo — technical-debt item 19), and the seeded dev `Shop` row's Shopify domain/admin token are placeholders too. This means the integration tests for `createFreightShipment` and `syncFreightTrackingToShopify` genuinely exercise the real Starshipit/Shopify APIs and genuinely fail — proving the honest reserve→attempt→fail path never corrupts state (the shipment ends up `FAILED` with a real reason; a Shopify sync failure is recorded via `IntegrationFailure` without touching the shipment's own `CREATED` status), rather than being skipped or mocked into a fake happy path.

### Deferred to later milestones

- Bin locations, barcode scanning, a full Packing milestone (warehouse picking itself now exists — see "Warehouse picking (Milestone 13)" below).
- Returns, customer reprint claims.
- Customer shipping notifications (`notifyCustomer: false` is permanent for this milestone).
- Voiding/cancelling a label with the carrier (technical-debt item 29).
- A carrier/service/packaging-preset discovery UI (technical-debt item 31).
- Multi-parcel/split shipments beyond a single Starshipit order-plus-label call.
- A dedicated "Fulfilled" Kanban column (folded into the existing catch-all this milestone).

## Warehouse picking (Milestone 13)

Milestone 12 lets staff freight a completed order with no gate beyond permission — no packing/warehouse model existed yet at the time. This milestone fills the gap: turning "an order gained the real Exported for Print Shopify tag" into a tracked staff task to physically gather every item for an order and hand it to packing. Deliberately narrow: a staff checklist workflow, not real inventory tracking — there is no SKU/bin on-hand-quantity model anywhere in this schema (only the generic, still-unused `Barcode`/`ScanEvent` scanning scaffold). See [ADR-0009](decisions/0009-warehouse-picking.md) for the full reasoning, including the milestone-numbering note (this shipped after Starshipit freight, so it's "Milestone 13" here despite being listed earlier in the architecture review's original ordering).

### Domain model — WarehousePickJob and WarehousePickItem

- **`WarehousePickJob`** — one per order, a real DB constraint (`@@unique([orderId])`), unlike `FreightShipment` which can legitimately have more than one row per order. `status` (`QUEUED`/`IN_PROGRESS`/`HANDED_OVER`/`CANCELLED`), `assignedStaffId`, `priority`, and a `version` field for the same optimistic-concurrency CAS pattern used elsewhere.
- **`WarehousePickItem`** — one row per `ShopifyOrderLine` on the order, created for every line regardless of decoration method — a blank, undecorated garment still has to be physically gathered. `requiredQuantity`/`sku`/`productTitle` are snapshotted at creation time. `pickedQuantity`/`shortQuantity`/`status` (`PENDING`/`IN_PROGRESS`/`PICKED`/`SHORT`) are derived, never hand-set directly.
- **`WarehousePickQuantityUpdate`** — append-only log, `@@unique([warehousePickItemId, idempotencyKey])` — the real DB-enforced duplicate-submission guard.
- **`WarehouseIssue`** — job-wide or item-specific via an optional `warehousePickItemId`, minus a file-attachment sub-model (not requested this milestone).
- **`WarehouseNote`** — internal only, create-only, job-scoped only — no item-level notes this milestone.

`ShopifyOrder.warehousePickSummary` (`OrderWarehousePickSummary`: `NOT_STARTED`/`IN_PROGRESS`/`HANDED_OVER`) is a rollup alongside `proofSummary` — an order can be fully exported-for-print while picking hasn't started, or picked while a later reprint reopens proofing.

### Auto-creation triggers off the real "Exported for Print" Shopify tag

`app/domain/warehouse/create-warehouse-pick-job.server.ts`'s `createWarehousePickJobForOrder(tx, {shopId, orderId, actorStaffId})` is idempotent (a plain existence check plus `WarehousePickJob`'s own `@@unique([orderId])`), so it's safe to call from more than one trigger without risking a duplicate. Two call sites detect "the order just gained the real `'Exported for Print'` Shopify tag" and call it: a manual Kanban drag into the Exported for Print column (`move-order-workflow-status.server.ts`, right after a successful/partial tag sync), and a regular Shopify sync bringing the tag in fresh (`import-order.server.ts`'s `wasExportedForPrintJustNow`, mirroring the file's own `wasFulfilledJustNow` pattern). This replaced an earlier design where auto-creation was gated on the now-removed Production Job system reaching completion — see [ADR-0014](decisions/0014-remove-production-artwork-and-jobs.md). `scripts/backfill-warehouse-pick-jobs.ts` creates pick jobs for orders that gained the tag before the new trigger existed.

### Job/item status is derived, never hand-set — with one deliberate exception

`app/domain/warehouse/pick-item-state.ts`'s `derivePickItemStatus` computes an item's status purely from `pickedQuantity`/`shortQuantity`/`requiredQuantity`. `app/domain/warehouse/pick-job-state.ts`'s `derivePickJobStatus` derives the job's status from its items — but `WarehousePickJobStatus` has **no distinct "ready for handover" value**: once every item reaches a terminal state, the job's derived status stays `IN_PROGRESS` until the explicit `handoverWarehousePickJob` action fires (technical-debt item 36), mirroring how `ProductionTask` completion is always explicit even though `ProductionJob.status` is otherwise derived. `app/domain/warehouse/recalculate.server.ts`'s `recalculateWarehousePickJobStatus` is the one writer of `WarehousePickJob.status` outside the explicit handover/cancel actions, called at the end of every item-level mutation inside the same transaction.

### Quantity recording, marking short, and blocking issues

`app/domain/warehouse/record-pick-quantity.server.ts`'s `recordPickQuantity` mirrors `record-production-quantity.server.ts` closely, minus the quality-check/rework dimensions production has — the `@@unique([warehousePickItemId, idempotencyKey])` constraint is the real duplicate-submission guard. It also checks for an open blocking `WarehouseIssue` on the item and rejects while one exists — `WarehousePickItemStatus` has no `BLOCKED` value (simpler than `ProductionTask`'s model); blocking is a query-time check, not a stored status. `app/domain/warehouse/mark-pick-item-short.server.ts`'s `markPickItemShort` marks whatever remains unaccounted for on a line as short — a deliberate staff declaration distinct from an ordinary partial pick still expecting more — and auto-creates a non-blocking `WarehouseIssue` (`STOCK_SHORTAGE`) documenting it, mirroring `perform-quality-check.server.ts`'s auto-issue-on-rework pattern. Per the milestone's own scope decision, **a short pick never blocks handover**.

### Handover to packing

`app/domain/warehouse/handover-warehouse-pick-job.server.ts`'s `handoverWarehousePickJob` is the one explicit terminal action, gated by `app/domain/warehouse/handover-eligibility.ts`'s `evaluateHandoverEligibility` — every item must be `PICKED` or `SHORT` (nothing `PENDING`/`IN_PROGRESS`), but a `SHORT` item never blocks it. On success: sets `WarehousePickJob.status = HANDED_OVER`, `ShopifyOrder.warehousePickSummary = HANDED_OVER`, and `workflowStatus = READY_TO_PACK` — finally making that `OrderStatus` value reachable (reserved since Milestone 06B), the same "this milestone finally reaches a long-reserved enum value" pattern as Milestone 12 reaching `FULFILLED`. `OrderStatus.PACKING` stays reserved for the still-unbuilt Packing milestone. Freight's own eligibility rule is deliberately not gated on `warehousePickSummary` — a freight label can in principle be created before an order's pick job is handed over to packing (technical-debt item 35).

### Routes, queue, and drawer UI

`app/domain/warehouse/pick-queue-filters.ts` + `pick-queue-query.server.ts` mirror the Kanban board's own `board-filters.ts` precedent, scaled to this domain's smaller field set (no due dates, no decoration method) — 5 named views (all active, assigned to me, unassigned, has shortage, handed over recently), 4 sort fields. `/warehouse` (`app/routes/warehouse.tsx` + `WarehousePickQueuePage`) is the queue screen; `/warehouse/:jobId` (`app/routes/warehouse.$jobId.tsx` + `WarehousePickJobDrawer`, rendered via the parent route's `<Outlet />` exactly like the order drawer) is the full workstation — pick list with quantity entry and mark-short controls, issues, notes, activity, and the handover action (disabled with a clear reason until every line is picked or marked short). `/warehouse/actions` is a single action-only resource route, one-route-many-intents, matching `orders.$orderId.proof-groups.tsx`'s convention. The order drawer's "Warehouse" tab shows a read-only summary + link out to the full workstation.

### Permissions

`warehouse_picks.view/assign/record_quantity/mark_short/handover`, `warehouse_issues.create/resolve`, `warehouse_notes.create` — granted in full to Manager. Packing Staff (this role's first real job-execution capability — it previously only had `freight_shipments.view/download`) get everything except `warehouse_issues.resolve`, mirroring exactly how Print Staff in production can create but not resolve issues.

### Kanban and dashboard integration

The Kanban board gained three new batched, no-N+1 `BoardCard` fields: `warehousePickSummary` (a direct column, no extra query), `hasOpenWarehouseIssue` and `hasShortPickItems` (one batched query each per board load). A card shows a "Ready to pack" success chip once `workflowStatus === READY_TO_PACK`, else a "Warehouse issue"/"Short pick"/"Picking" chip depending on state. (Post-redesign: `handoverWarehousePickJob`'s existing `workflowStatus → READY_TO_PACK` write now *also* moves the card into the dedicated "Pack" Kanban column — this file was never touched for the redesign, it just started feeding a real column instead of the old catch-all.) The dashboard gained a small "Warehouse picking at a glance" counts section (queued/in-progress/handed-over-today/with-shortage) and a shortcut card — no full `/warehouse/report` page this milestone.

### Concurrency and idempotency

Every guarantee is backed by a real DB constraint: `@@unique([orderId])` for pick-job creation, `@@unique([warehousePickJobId, orderLineId])` for item creation, `@@unique([warehousePickItemId, idempotencyKey])` for quantity submissions. Assignment uses the same `version`-based optimistic-concurrency CAS as production. Status transitions use scoped `updateMany` on an expected-status WHERE clause; a duplicate handover/cancel returns `already_there` rather than creating a second transition.

### Deferred to later milestones

- Real inventory/stock-level tracking and a genuine bin-location model (technical-debt item 33).
- Barcode/scanner-driven pick confirmation (technical-debt item 34).
- Gating freight eligibility on `warehousePickSummary` (technical-debt item 35).
- A dedicated Kanban column for `READY_TO_PACK` and a full `/warehouse/report` page.
- Item-level notes (job-level only) and `WarehouseIssue` file attachments.
- The Packing milestone itself, returns, and customer reprint claims.

## Exception cases — returns, warranty, defects (Milestone 14)

Everything that happens when something goes wrong after an order has otherwise moved through the pipeline: a customer return, a warranty claim, a production defect caught late — and the resolutions that follow (reprint, credit, refund, exchange), plus the investigation workflow to manage it. Deliberately independent of `workflowStatus` — a return can happen well after `FULFILLED`/`ARCHIVED`. See [ADR-0010](decisions/0010-exception-cases.md) for the full reasoning, including why a pre-existing, unused `Reprint`/`ReprintAsset` model was removed rather than extended, and the milestone-numbering note.

### Domain model — ExceptionCase and ExceptionCaseResolution

- **`ExceptionCase`** — one unified entity for all three feature areas, classified by `category` (`CUSTOMER_RETURN`/`WARRANTY_CLAIM`/`PRODUCTION_DEFECT`/`OTHER`) and, orthogonally, `initiatedBy` (`CUSTOMER`/`STAFF`). `status` (`OPEN`/`INVESTIGATING`/`AWAITING_CUSTOMER`/`RESOLVED`/`CANCELLED`) is hand-set via explicit staff transitions — no multi-child rollup exists here the way `WarehousePickJobStatus` derives from item states, so this mirrors `ProofGroup.status`'s own directly-set style instead. `caseNumber` is sequential per order (`@@unique([orderId, caseNumber])`), same retry-on-conflict pattern as `ExportBatch.batchNumber`. Carries its own `returnLabelProvidedAt`/`returnLabelNote` fields — manual/external fact-recording, no carrier API call.
- **`ExceptionCaseResolution`** — a child table, not fields flattened onto the case, since a case can accumulate more than one resolution over time (denied, then reconsidered) — mirrors `ProofVersion`'s "one row per decision event" precedent. `resolutionType` (`REPRINT`/`CREDIT`/`REFUND`/`EXCHANGE`/`DENIED`) and `status` (`PENDING`/`COMPLETED`) are independent: a resolution is *decided* first, then separately marked *completed* once actually carried out externally — nothing auto-completes silently, the same rule this codebase applies everywhere else. `amount`/`currencyCode` (record-only, no Shopify mutation) populate only for CREDIT/REFUND; `exportBatchId` populates only for REPRINT/EXCHANGE.
- **`ExceptionCaseAttachment`**/**`ExceptionCaseNote`** mirror `ProductionIssueAttachment`/`ProductionNote`'s shapes exactly, at case scope.

No new `ShopifyOrder` rollup column — the Kanban indicator is a simple batched boolean (`hasOpenExceptionCase`), not a summary enum, since a case doesn't roll up multiple children the way `warehousePickSummary` does.

### REPRINT/EXCHANGE resolution is record-only — same shape as CREDIT/REFUND/DENIED

`app/domain/exceptions/resolve-exception-case.server.ts`'s `resolveExceptionCase` is the centrepiece. REPRINT/EXCHANGE used to call the real production/export pipeline directly to produce a genuine new reprint artefact; that pipeline was removed entirely (see [ADR-0014](decisions/0014-remove-production-artwork-and-jobs.md)), so REPRINT/EXCHANGE now converge onto the exact same record-only shape CREDIT/REFUND/DENIED already use — resolving a case just records the decision and reason, nothing more. `proofGroupId` is still accepted on the resolution input but no longer required or acted on. CREDIT/REFUND validate a positive `amount`; every type just requires the always-required `reason` — all via the pure `app/domain/exceptions/resolution-validation.ts`'s `validateResolutionInput`. A real reprint/exchange redesign is deferred until this flow is actually tested in practice (technical-debt item 37).

### Status transitions

`app/domain/exceptions/case-transitions.ts`'s `validateCaseStatusTransition` is a small pure state machine: `OPEN → INVESTIGATING → AWAITING_CUSTOMER → RESOLVED` (with `INVESTIGATING`/`AWAITING_CUSTOMER` interchangeable once investigation has started), `CANCELLED` reachable from any non-terminal state via the separate `canCancelCase`, nothing reachable once `RESOLVED`/`CANCELLED`. `app/domain/exceptions/transition-exception-case-status.server.ts` wraps this with the real DB-side CAS check (`updateMany` on the expected current status) and an `ActivityEvent`.

### Routes, queue, and drawer UI

Given "investigation workflow" was an explicit requirement and cases aren't well-represented on the Kanban board's forward-pipeline-oriented columns, this stays a dedicated queue rather than order-drawer-only like Freight/Proofs: `/exceptions` (`app/routes/exceptions.tsx` + `ExceptionQueuePage`) is the queue screen (5 named views, 3 sort fields); `/exceptions/:caseId` (`app/routes/exceptions.$caseId.tsx` + `ExceptionCaseDrawer`, rendered via the parent route's `<Outlet />`) is the full workstation — status transitions, assignment, return-label recording, the resolution form, mark-completed, notes, activity. `/exceptions/actions` is a single global action-only resource route, one-route-many-intents, used by **both** the workstation drawer and the order drawer's own Exceptions tab (order ID passed as a plain form field, same convention `orders.$orderId.proof-groups.tsx` uses for proof-group IDs). Unlike the read-only Freight/Warehouse order-drawer tabs (whose underlying jobs are auto-created), the Exceptions tab also includes an inline "Report a problem" create form, since cases are always staff-initiated.

### Permissions

`exception_cases.view/create/update/assign/resolve/cancel`, `exception_notes.create` — granted in full to Manager/Administrator. Artwork Staff, Print Staff, and Packing Staff get `view`/`create`/`exception_notes.create` only — anyone can log a problem and add notes, but only management updates/assigns/resolves/cancels a case.

### Kanban and dashboard integration

`app/domain/orders/board-query.server.ts` gained `loadOpenExceptionCaseOrderIds`, a batched, no-N+1 helper feeding a new `BoardCard.hasOpenExceptionCase` boolean — one `IndicatorChip` in `OrderCard.tsx`, linking to `/exceptions`. No new Kanban column. The dashboard gained a small "Exceptions at a glance" counts section (open/investigating/awaiting-customer/resolved-today) and a shortcut card, mirroring Warehouse's own dashboard addition.

### Deferred to later milestones

- Any real Shopify refund/store-credit mutation, and any return-label generation API call — both deliberate record-only/manual scope boundaries (technical-debt item 39).
- A real REPRINT/EXCHANGE redesign now that the production/export pipeline it used to call is gone — deferred until this flow is actually tested in practice (technical-debt item 37).
- `ExceptionCaseAttachment` upload UI (technical-debt item 38).
- A new `StaffUser` role for customer service — existing roles reused, per precedent.
