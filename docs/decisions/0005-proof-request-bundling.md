# ADR-0005: Bundle several proof groups behind one `ProofRequest` token, not a token per `ProofVersion`

**Status:** Accepted.

## Context

Milestone 08 already reserved `secureTokenHash`/`tokenExpiresAt`/`tokenRevokedAt` fields directly on `ProofVersion`, unused. That shape implies one secure link per proof *version* — a customer with an order containing three proof groups would need three separate emailed links to review all of them.

Milestone 09 explicitly requires the opposite: "one order → one proof request → several proof groups, each independently approvable," with the customer opening a single secure page that lists every selected proof group at once. A per-version token cannot represent that — there would be no single token to put in one email, and no natural place to record "this is one customer communication event" (who it was sent to, when, whether it's been viewed, whether it's complete) once more than one version is involved.

## Decision

Add two new models and remove the now-redundant per-version token fields:

- **`ProofRequest`** — the actual token holder and the "one customer communication event" record: `tokenHash` (unique), `tokenExpiresAt`, `revokedAt`/`revokedReason`/`revokedByStaffId`, `status` (`ProofRequestStatus`), `customerEmail`/`customerName` (a snapshot, not a live join to `ShopifyOrder`, so a later Shopify sync changing the customer's email never rewrites who a past request was actually sent to), view tracking (`firstViewedAt`/`lastViewedAt`/`viewCount`), and `completedAt`.
- **`ProofRequestGroup`** — a join row per proof group included in the request, recording the **exact** `proofVersionId` sent. This is the field that makes "a proof request must permanently preserve which version the customer received" true even after a later version supersedes it.
- Removed from `ProofVersion`: `secureTokenHash`, `tokenExpiresAt`, `tokenRevokedAt` (safe — confirmed zero rows had any of these set, and zero application code referenced them; they were pure schema placeholders from Milestone 08). `ProofVersion.sentAt`/`viewedAt`/`respondedAt`/`approvedAt` are kept, as status-transition timestamps independent of which request carried them.
- Repointed `ProofReminder.proofVersionId` → `proofRequestId` (one reminder per request, not per version — "one automatic reminder" is a property of the communication event, not of each bundled version) and added `proofRequestId` to `CustomerProofResponse` and `KlaviyoDispatch` so both can be traced back to the exact send event they belong to.

`ProofRequestStatus` deliberately has no stored `EXPIRED` value — expiry is a comparison (`tokenExpiresAt < now()`) done at token-resolution time, not a state a background job needs to flip. This keeps expiry correct even if a job is delayed or never runs, at the cost of `EXPIRED` never appearing as a literal value in a staff-facing status filter (the query layer computes it instead).

## Current limitations

- A `ProofRequestGroup` row references `proofVersionId` directly rather than also carrying its own status; the actionable state for a given group-within-a-request is derived from the referenced `ProofGroup.status`/`ProofVersion.status` plus whether a newer, unresolved `ProofRequest` now supersedes it — this is a join-time computation, not a denormalised column, so it must be kept correct in the query layer rather than trusted from a single field.
- `KlaviyoDispatch.proofGroupId` (Milestone 08) remains a loose, unrelated field — it was never given a foreign key, and this migration doesn't add one. `KlaviyoDispatch.proofRequestId` is the one to use for anything proof-request-shaped going forward.

## Risks

- None beyond the general single-instance/local-disk-storage constraints already tracked in ADR-0001/ADR-0004 — this decision only reshapes empty tables (nothing had ever written to `ProofVersion`'s token fields, `CustomerProofResponse`, or `ProofReminder`), so there was no real data to migrate or risk losing.

## Conditions that trigger reconsideration

- If a future requirement needs a token scoped to a single proof group rather than a whole request (e.g. a customer wanting to forward just one group's link to someone else) — today's design cannot represent that without adding a second, narrower token type.

## Required future work

None — this is considered a complete, stable shape for Milestone 09 and the deferred customer-account-history work that builds on it later.
