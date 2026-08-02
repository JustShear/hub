# Security review (Milestone 16)

A manual review, performed directly rather than via a separate billed audit tool, covering the areas the Milestone 16 plan called out. Anything concretely broken was fixed immediately rather than just noted here.

## Scope and method

Sampled across the codebase rather than reviewing every file line-by-line — the eight action routes and eight domain files checked were chosen to span every "shape" of route/domain code in the app (queue-scoped resource routes, order-scoped mutations, own-entity-only mutations like notifications, and idempotent external-API writes like freight). Findings below are honest about what was and wasn't checked; this is not a substitute for a dedicated penetration test before a real production go-live (see `docs/production-readiness-checklist.md`, Milestone 16's own closing deliverable, for the overall verdict).

## 1. Permission-check-before-domain-call ordering

Sampled: `orders.tsx`, `production.actions.tsx`, `warehouse.actions.tsx`, `exceptions.actions.tsx`, `orders.$orderId.proof-groups.tsx`, `orders.$orderId.freight.tsx`, `notifications.actions.tsx`, `dev.orders.tsx`.

**Result: clean.** Every route calls `requireStaffUser(request)` before touching any request-derived data, and every intent branch calls `hasPermission(staffUser, "...")` and returns an error before calling any domain-layer mutation — never after. `notifications.actions.tsx` has no `hasPermission` calls, which is intentional and documented in its own code comment: every mutation there is scoped to the caller's own `staffUserId` (see IDOR section below), so there's no cross-user action to gate in the first place.

## 2. IDOR (insecure direct object reference)

Sampled: `assign-production-task.server.ts`, `warehouse-issue.server.ts`, `assign-exception-case.server.ts`, `orders/saved-views.server.ts`, `saved-views/generic-saved-view.server.ts`, `notifications/mark-notification-read.server.ts`, `manually-approve-proof-version.server.ts`, `freight/create-freight-shipment.server.ts`.

**Result: one real gap found and fixed; one design choice reviewed and accepted.**

- **Fixed:** `createFreightShipment`'s idempotency-key duplicate check looked up `db.freightShipment.findUnique({ where: { idempotencyKey } })` with no `shopId` in the where clause. `idempotencyKey` is globally `@unique` in the schema (not compound with `shopId`), so this was functionally safe against cross-shop data leakage only because idempotency keys are client-generated random UUIDs, not guessable — but it meant `shopId` (already passed into the function) was silently unused for this one lookup. Changed to `findFirst({ where: { idempotencyKey, shopId } })` for defense in depth — a caller can no longer even theoretically get back another shop's `freightShipmentId` by reusing or guessing its idempotency key.
- **Reviewed, accepted:** `findOwnedView()` (both the board's `saved-views.server.ts` and the new generic `saved-views/generic-saved-view.server.ts`) fetches a `SavedView` row by `id` alone, then checks `view.staffUserId !== staffUserId` — scoped to `staffUserId`, not `shopId`, unlike every other domain function's `shopId`-scoped pattern. This is safe because a `staffUserId` is only ever resolved from a signed session cookie tied to one shop (`requireStaffUser` never returns a foreign shop's user), so there is no path for a caller to present another shop's `staffUserId`. It diverges from the codebase's usual convention on its face, but the actual trust boundary (the session, not the request body) is the same one every other route relies on. This predates Milestone 16 (introduced in Milestone 06B) and was reviewed, not changed.
- Everything else sampled — `assignProductionTask`/`assignProductionJob`, `createWarehouseIssue`/`resolveWarehouseIssue`, `assignExceptionCase`, `markNotificationRead` (correctly scoped to `staffUserId`, the right scope for a personal notification), `manuallyApproveProofVersion` — scopes every lookup by `shopId` (or the equivalent `staffUserId` for own-entity data) before reading or mutating.

## 3. Secrets handling

- `.env`/`.env.local` are gitignored (`.gitignore` lines 3-4).
- No `console.log`/`console.error` anywhere in `app/` logs `env.*`, `process.env`, `passwordHash`, `adminApiToken`, or `SESSION_SECRET` (grepped directly).
- `Shop.adminApiToken` is read in exactly two places (`sync-tracking-to-shopify.server.ts`, `import-order.server.ts`), both passed straight into the Shopify GraphQL client, never returned from a loader/action. The one route that loads a `Shop` row for client-facing use (`orders.$orderId.tsx`) explicitly `select`s only `shopifyDomain`.
- `loadStaffUserWithPermissions` (`staff-session.server.ts`) builds its `StaffUserWithPermissions` return object field-by-field and never includes `passwordHash`.

## 4. XSS

Zero uses of `dangerouslySetInnerHTML` anywhere in `app/` — the one text match is a code comment in `add-note.server.ts` explicitly documenting that notes are never rendered that way. React's default JSX escaping is the only rendering path for any user-entered text (order notes, exception summaries, issue descriptions, etc.).

## 5. Session cookie flags

`staff-session.server.ts`'s `createCookieSessionStorage` config: `httpOnly: true`, `sameSite: "lax"`, `secure: process.env.NODE_ENV === "production"`, signed via `secrets: [env.SESSION_SECRET]`, 7-day `maxAge`. All four flags are exactly what's expected for a same-site session cookie; `secure` is correctly conditional since local dev runs over plain HTTP.

## 6. `npm audit`

`npm audit` (default, and again with `--production`): **0 vulnerabilities**, both runs.

## 7. Login rate limiting

**Gap found and fixed.** There was no throttling of any kind on `/login` — an attacker could attempt unlimited password guesses against any known email. Added `app/auth/login-rate-limit.server.ts`: an in-memory, per-process fixed-window limiter (5 failed attempts per email+IP pair per 15 minutes), wired into `login.tsx`'s action before credential verification. A successful login clears the count; the generic "Incorrect email or password" error message is unchanged (still never reveals which field was wrong), and a rate-limited attempt gets its own distinct message.

This is deliberately in-memory rather than backed by a persistent store — the same rationale as [ADR-0001](decisions/0001-single-instance-job-execution.md)'s in-process job poller: this app is constrained to a single instance today, so there's no cross-instance state to reconcile, and a lightweight brute-force deterrent doesn't need the durability or cleanup-job overhead a persistent store would require. It resets on process restart/deploy; that's an accepted tradeoff for a low-traffic internal staff tool, not an oversight. If the single-instance constraint is ever lifted, this limiter would need to move to a shared store (e.g. Redis) at the same time — noted so it isn't rediscovered as a surprise later.

Tested in `tests/unit/auth/login-rate-limit.server.test.ts` (5 tests: under-threshold allowed, over-threshold blocked with a retry-after, email+IP independence, clears on success, case-insensitive email matching).

## Not covered by this pass

- No dependency-level SAST/DAST tool was run (out of scope — this was a manual, targeted review, not the separate `/code-review ultra` workflow).
- Rate limiting on the **public** `/proof/:token` customer-facing routes remains a known open item (technical-debt #17), unrelated to and not resolved by this milestone's login rate limiter.
- The `/proof/:token` token itself, CSRF posture on state-changing forms, and Shopify webhook HMAC verification were not re-reviewed this pass — they were reviewed and tested when originally built (Milestones 04 and 09) and no new code touched them this milestone.
