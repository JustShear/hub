# ADR-0004: Interim local-disk storage for proof files, behind a provider-agnostic adapter

**Status:** Resolved (Milestone 16) for the storage-provider risk this ADR describes — see [ADR-0011](0011-cloudflare-r2-migration.md). `localDiskStorageAdapter` still exists and is still the adapter used in development and the test suite; only production traffic now goes through `r2StorageAdapter`. The signed-URL follow-up noted below under "Required future work" was **not** done this milestone — every file route still streams bytes through the Node process rather than redirecting to a provider-signed URL.

**Update (Milestone 10):** production artwork files and generated export packages reuse `localDiskStorageAdapter` unchanged — no new adapter, no new decision. Every risk and required-future-work item below applied equally to them; ADR-0011's R2 migration covers all four call sites (proof files, production artwork, export packages, freight labels), not just the original proof-file use case.

## Context

Milestone 08 (Proof Groups and Proof Versions) needed real file storage: uploaded proof files must be persisted, retrievable, and — per the milestone's own rules — never overwritten in place and never lost on a failed transaction. The architecture review's own milestone plan sequences "secure file storage" (SRS Milestone 11, using Cloudflare R2) **after** proof groups and proof versions (SRS Milestones 09/10, together this session's "Milestone 08"). `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` env vars already existed and are validated at boot (`app/lib/env.server.ts`), but nothing in `app/adapters/storage/` (empty except `.gitkeep`) ever read them — no R2 client existed to build a proof-upload feature on top of.

Building the full R2 integration out of sequence, ahead of the milestone that owns it, was rejected as scope creep beyond what Milestone 08 asked for. Faking storage (e.g. only recording metadata with no real bytes anywhere) was rejected outright — it would violate the project's honesty rules (no non-functional controls presented as complete) and make "internal preview of proof files," an explicit Milestone 08 requirement, impossible to actually build or test.

## Decision

Define a small, provider-agnostic `StorageAdapter` interface (`app/adapters/storage/storage-adapter.server.ts`):

```ts
export interface StorageAdapter {
  putObject(params: { key: string; body: Buffer }): Promise<void>;
  getObjectBuffer(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
}
```

Implement it once, concretely, as `localDiskStorageAdapter` (`app/adapters/storage/local-disk-storage.server.ts`), writing real bytes to a gitignored `.storage/` directory (`STORAGE_ROOT`, overridable via `PROOF_STORAGE_DIR`). Every proof-domain caller (`create-proof-version.server.ts`, `proof-assets.$assetId.tsx`) depends only on the `StorageAdapter` interface's shape, not on any local-disk-specific detail — so Milestone 11's real R2 adapter is a second implementation of the same four methods plus a one-line swap of which adapter gets imported, not a rewrite of calling code.

## Current limitations

- `localDiskStorageAdapter` stores files on the local filesystem of whichever process runs the Node app. It has no redundancy, no CDN, no cross-region durability, and is scoped to one server instance's disk.
- `resolveObjectPath()` does a path-containment check as defense in depth, but the adapter is still fundamentally trusting the local filesystem for durability — a disk failure or instance replacement loses every stored proof file.
- `putObject()` refuses to overwrite an existing key (throws), matching the domain rule "never overwrite a proof version" — but this is enforced by the adapter, not by any storage-provider-level immutability guarantee.
- No signed URLs: `proof-assets.$assetId.tsx` streams bytes directly through the Node process (`Content-Disposition: inline`), rather than redirecting to a short-lived, provider-signed URL as the SRS's file-storage milestone eventually calls for.

## Risks

- **Not viable in a horizontally-scaled or ephemeral-filesystem deployment.** If this app is ever deployed to more than one instance, or to a platform with an ephemeral/non-persistent filesystem (e.g. most container platforms without an attached persistent volume), uploaded proof files become inconsistently visible (uploaded via instance A, 404 when read from instance B) or are lost outright on redeploy. This compounds [ADR-0001](0001-single-instance-job-execution.md)'s existing single-instance constraint — this application must not be scaled horizontally until **both** the job-poller and the storage layer are replaced.
- **No off-instance backup.** A lost disk (or a misconfigured deploy that doesn't provision a persistent volume) means lost proof files, with no separate copy anywhere.

## Conditions that trigger reconsideration

- SRS Milestone 11 ("Secure file storage") begins — implement `r2StorageAdapter` against the same `StorageAdapter` interface and switch the one import in `create-proof-version.server.ts` / `proof-assets.$assetId.tsx`.
- Any decision to run more than one instance of this application concurrently, or to deploy to a platform without a guaranteed-persistent local disk — either makes the local-disk adapter unsafe immediately, not just eventually.
- A real customer-facing proof-sending workflow is built (a later milestone) — customers must never be sent a link that depends on this app's own process being alive to serve the bytes; that milestone requires the durable/signed-URL storage layer to exist first.

## Required future work

- Implement a Cloudflare R2 `StorageAdapter` (SRS Milestone 11), using the already-validated `R2_*` env vars.
- Add signed-URL generation so `proof-assets.$assetId.tsx` (or its Milestone-11 equivalent) redirects to a time-limited provider URL instead of streaming bytes through the app process.
- Add a migration path for existing local-disk-stored proof files to R2 if any real (non-demo) data is ever created against the local-disk adapter before the swap happens.

Tracked as technical debt — see `docs/technical-debt.md`. Deployment documentation (Milestone 23) must state the persistent-storage/single-instance requirement explicitly, alongside ADR-0001's job-poller constraint.
