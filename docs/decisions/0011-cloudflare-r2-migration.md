# ADR-0011: Cloudflare R2 storage migration (Milestone 16)

**Status:** Accepted.

## Context

[ADR-0004](0004-interim-local-disk-proof-storage.md) shipped local-disk storage behind a provider-agnostic `StorageAdapter` interface back at Milestone 08, explicitly as an interim measure — "must be replaced before production go-live." `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` have been required-and-validated at boot (`app/lib/env.server.ts`) since Milestone 02, unused the entire time — reserved ahead of the adapter, the same pattern as `Barcode`/`ScanEvent`. Four call sites accumulated on the local-disk adapter over the milestones since: proof versions (M08), production artwork and export packages (M10), freight labels (M12).

## Decision

Implement a second `StorageAdapter`: `app/adapters/storage/r2-storage.server.ts`, using `@aws-sdk/client-s3` against R2's S3-compatible endpoint (`https://{account_id}.r2.cloudflarestorage.com`) — Cloudflare's own documentation recommends the AWS SDK rather than a bespoke client, since R2 deliberately implements the S3 API surface.

**A factory, not a hard swap.** `app/adapters/storage/get-storage-adapter.server.ts` picks `r2StorageAdapter` when `NODE_ENV === "production"`, `localDiskStorageAdapter` otherwise. Every one of the 12 call sites (6 domain functions that write, 6 routes that read) now imports `storageAdapter` from the factory instead of importing `localDiskStorageAdapter` directly — a one-line import change per file, exactly as ADR-0004 predicted. Test files keep importing `localDiskStorageAdapter` directly for their own cleanup, since tests always run outside `NODE_ENV=production` and the factory would resolve to the same adapter anyway — there was no reason to touch 3 already-working test helper files for a change that wouldn't alter their behaviour.

**`putObject`'s overwrite guard is a HeadObject-then-PutObject check, not an atomic conditional write.** S3/R2 has no universally-supported atomic "create if not exists" the AWS SDK v3 exposes simply; this is the same class of narrow, documented race window this codebase already accepts elsewhere (storage keys are always server-generated, never derived from user input, so a genuine collision is vanishingly unlikely in practice) — not a new risk category introduced by this migration.

**Not verified against a real Cloudflare bucket in this environment.** The adapter is tested against the `StorageAdapter` interface contract with a mocked S3 client (`tests/unit/adapters/storage/r2-storage.server.test.ts`) — there is no real R2 bucket reachable from this development environment. This mirrors ADR-0008's own honest "not confirmed against a real sandbox account" precedent for Starshipit. The first real deploy must confirm actual bucket connectivity before being trusted with real customer data.

**Signed URLs were explicitly not built this milestone.** ADR-0004's "required future work" also called for `proof-assets.$assetId.tsx` (and its siblings) to redirect to a short-lived, provider-signed URL instead of streaming bytes through the Node process. That's a separate, larger change (touching every file-serving route's response shape) and wasn't part of this migration's scope — every file route still calls `getObjectBuffer` and streams the result through the app process, now reading from R2 instead of local disk. Streaming through the app process works correctly either way; it's simply not as efficient or scalable as a signed-URL redirect would be.

## Current limitations

- No signed-URL redirect — see above. Technical-debt item, tracked below.
- `putObject`'s overwrite guard has a narrow, accepted race window (HeadObject-then-PutObject, not atomic).
- Real bucket connectivity is unverified in this environment — mocked-client tests only.

## Risks

Minimal, given the interface was designed for exactly this swap. The main residual risk is the untested-against-a-real-bucket gap above — a first real deploy should smoke-test an actual upload/download/delete cycle against the real R2 bucket before trusting it with real customer proof files.

## Conditions that trigger reconsideration

- If per-request R2 latency or egress patterns make streaming-through-the-app noticeably worse than a signed-URL redirect would be — build the signed-URL follow-up then, not speculatively now.
- If R2's S3-API compatibility gains (or already has, unconfirmed) a genuine atomic conditional-write header — tighten `putObject`'s guard to use it instead of the HeadObject-then-PutObject check.

## Required future work

- Signed-URL redirects for every file-serving route (technical-debt item 40).
- A real-bucket smoke test as part of the first production deploy's own checklist (see `docs/deployment.md` and `docs/production-readiness-checklist.md`).
