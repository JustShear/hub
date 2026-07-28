# Developer documentation

This document covers things a developer needs to know that aren't obvious from the code alone. It grows milestone by milestone — this revision adds Milestone 07 (Full Order Drawer) on top of Milestones 01–06B.

## Shopify scopes

The app requests exactly three read scopes — no write scopes exist yet (tag sync is Milestone 15):

- `read_orders`
- `read_products`
- `read_customers`

Configured once, manually, when the custom app is created in Shopify Admin → Settings → Apps → Develop apps. There is no OAuth scope-grant flow to keep in sync — `Shop.scopes` in the database is a record of what was granted, not something the app negotiates at runtime.

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

### Board-column mapping

`workflowStatus` (`OrderStatus`, 16 values) remains the core status model — nothing about it changed. `app/domain/orders/board-columns.ts` is the *one* place that maps it down to the SRS's 7 Stage One columns, since `OrderStatus` is more granular than the board needs and doesn't have distinct values for two of the columns:

| Priority | Column | Rule |
| --- | --- | --- |
| 1 | Changes Requested | `proofSummary = CHANGES_REQUESTED` (promotes ahead of workflowStatus — no distinct `OrderStatus` value exists for this) |
| 2 | Proof Sent | `proofSummary = WAITING_ON_CUSTOMER` (same reasoning) |
| 3 | New | `workflowStatus = NEW` |
| 4 | Proof Being Prepared | `workflowStatus IN (ARTWORK_REQUIRED, PROOFING_IN_PROGRESS)` |
| 5 | Waiting on Customer | `workflowStatus = WAITING_CUSTOMER` |
| 6 | Proof Approved | `workflowStatus IN (PARTIALLY_APPROVED, READY_FOR_EXPORT)` |
| 7 | Exported for Print | `workflowStatus IN (PARTIALLY_EXPORTED, EXPORTED_FOR_PRINT, IN_PRODUCTION, PARTIALLY_COMPLETE, READY_TO_PACK, PACKING, FULFILLED)` — a catch-all, since no production/warehouse/packing screen exists yet to send these orders to |

Rules are evaluated top-to-bottom; the first match wins (`getBoardColumnKey`). Rules 3–7 partition every non-special `OrderStatus` value exactly once (verified by a unit test), so no active order can ever fail to land in a column. `ON_HOLD`, `CANCELLED`, and `ARCHIVED` never appear on the main board at all (`isSpecialStatus`) — they live in their own read-only tab (SRS 9.2).

**To add a workflow status safely**: add the new `OrderStatus` enum value in `prisma/schema.prisma` (migration), then add it to exactly one of the `PROOF_BEING_PREPARED_STATUSES` / `PROOF_APPROVED_STATUSES` / `EXPORTED_STATUSES` arrays (or `SPECIAL_STATUSES` if it should never appear on the main board) in `board-columns.ts`. The "never orphaned" unit test will fail loudly if you forget.

### Status-transition policy (temporary — will tighten)

`app/domain/orders/workflow-transitions.ts`'s `canMoveOrderToColumn` is the single, server-authoritative policy (`move-order-workflow-status.server.ts` calls it independently of whatever the client sent). Only **4 of the 7 columns are drag/Move-to destinations**:

- **New**, **Proof Being Prepared**, **Waiting on Customer**, **Proof Approved** — interactive; dropping a card sets `workflowStatus` to that column's representative value (`NEW`, `PROOFING_IN_PROGRESS`, `WAITING_CUSTOMER`, `READY_FOR_EXPORT` respectively).
- **Changes Requested**, **Proof Sent** — read-only. They're driven by `proofSummary`, which is a computed rollup owned by proof-group/customer-response business logic that doesn't exist yet (proof groups aren't created until a later milestone) — nothing manually sets them from the board.
- **Exported for Print** — read-only per the milestone's own instruction: exporting requires proof approval and export records that don't exist yet, so it's reserved for a future dedicated export action rather than a casual drag.
- Any order whose `workflowStatus` is `ON_HOLD`, `CANCELLED`, or `ARCHIVED` cannot be moved anywhere from the board — reactivating one isn't supported yet (no matching `OverrideType` exists for it, and building a full override-approval flow is out of scope for this milestone).

**Tighten later**: once proof-group creation, sending, and customer responses ship, "Changes Requested" and "Proof Sent" should become populated by real proof-response logic (already handled correctly, since the column mapping keys off `proofSummary`) — no board-side change needed there. Once export ships, replace the "Exported for Print is read-only" rule with a proper permission + audit check tied to that action. Once a reactivation override type exists, wire it into `canMoveOrderToColumn`'s special-status branch instead of unconditionally rejecting.

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
- A dedicated production/warehouse/packing screen — until one exists, everything past active proofing collapses into the "Exported for Print" catch-all column.

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
