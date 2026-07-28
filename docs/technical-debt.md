# Technical debt register

Open items, tracked deliberately rather than left implicit in code comments alone. Each links to its full ADR where one exists.

| # | Item | Status | Introduced | ADR |
| --- | --- | --- | --- | --- |
| 1 | Shopify `shop/redact` has no automated data-erasure workflow; `customers/redact` only covers `ShopifyOrder` fields, not the ~10 other models that may carry a customer's data | **BLOCKING BEFORE PRODUCTION** | Milestone 04 | [ADR-0002](decisions/0002-deferred-shopify-privacy-erasure.md) |
| 2 | Background job processing runs on a single in-process poller with no cross-instance locking | Acceptable for single-instance deployment only | Milestone 04 | [ADR-0001](decisions/0001-single-instance-job-execution.md) |
| 3 | Addresses, discount codes, and fulfilments stored as opaque JSON, not normalised/queryable | Acceptable for current milestone | Milestone 04 | [ADR-0003](decisions/0003-opaque-commerce-json.md) |
| 4 | `ShopifyOrder.rawPayload` has a `rawPayloadPurgeAt` column but no job populates or acts on it — raw payloads are retained indefinitely in practice | Open, not yet blocking | Milestone 02 | — (folds into ADR-0002's retention-period scope) |
| 5 | GraphQL query field names, the `fulfilledQuantity` formula, and OPTIS property-detection heuristics are unverified against a real Shopify store or real OPTIS payloads | Open, flagged for validation | Milestone 04 | — (see `docs/development.md` "Known limitations") |
| 6 | `package.json#prisma` seed config is deprecated (Prisma 7 will remove it); no `prisma.config.ts` migration done yet | Low priority, cosmetic warning only | Milestone 02 | — |
| 7 | Global search and the notification menu are honest, non-functional shells (no search backend, no notification source) | Acceptable — intentional scope boundary, not a defect | Milestone 06A | — (see `docs/development.md` "Application shell") |
| 8 | Kanban board: "Changes Requested"/"Proof Sent" columns and "Exported for Print" are not manually draggable; on-hold/cancelled/archived orders can't be reactivated from the board | Acceptable — depends on proof-group creation, the export action, and an override type that don't exist yet | Milestone 06B | — (see `docs/development.md` "Status-transition policy") |
| 9 | Kanban board has no real-time cross-staff sync — each staff member sees their own last-fetched state until they navigate or refetch | Open, not yet blocking (single-instance internal tool, low concurrent-edit risk today) | Milestone 06B | — (architecture review already floats polling as a Stage Two candidate) |
| 10 | `OrderNote` has no `edited`/`deletedAt` columns — the order drawer's Notes tab is create-only; editing or removing a note isn't possible yet | Acceptable — intentional scope boundary until the schema supports it | Milestone 07 | — (see `docs/development.md` "Internal notes") |
| 11 | `CustomerArtworkAsset` has no checksum field — the Uploads tab can't show one, and duplicate-content detection across differently-named uploads isn't possible | Open, not yet blocking | Milestone 07 | — (see `docs/development.md` "Uploads: grouped strictly by line") |
| 12 | Order drawer has no real-time cross-staff sync (same limitation as the board) — an edit by one staff member only appears to another after their next load/revalidation | Open, not yet blocking | Milestone 07 | — (see `docs/development.md` "Concurrency: revalidation, not just CAS") |
| 13 | Proof files are stored on local disk (`.storage/`), not Cloudflare R2 — no redundancy, no CDN, unsafe under horizontal scaling or an ephemeral filesystem | **Must be replaced before production go-live**; compounds ADR-0001's single-instance constraint | Milestone 08 | [ADR-0004](decisions/0004-interim-local-disk-proof-storage.md) |
| 14 | `proof-assets/:assetId` streams proof-file bytes directly through the Node process rather than redirecting to a short-lived signed URL | Open, tied to item 13 — resolves with the same R2 migration | Milestone 08 | [ADR-0004](decisions/0004-interim-local-disk-proof-storage.md) |
| 15 | `ProofRequirementValue.PARTIALLY_REQUIRED` and several `ProofGroupStatus`/`ProofVersionStatus` enum values (`SENT`, `VIEWED`, `CHANGES_REQUESTED`, `APPROVED`, `READY_FOR_EXPORT`, `EXPORTED_FOR_PRINT`) exist in the schema but are unreachable this milestone — no code path sets them yet | Acceptable — intentional scope boundary, reserved for the customer-proofing and export milestones | Milestone 08 | — (see `docs/development.md` "Proof groups and proof versions (Milestone 08)") |

## Item 1 detail — production-readiness blocker

**Do not approve this application for live production use until this is resolved.** A dedicated milestone, **"Privacy, Retention and Shopify Data Erasure,"** has been added to the milestone plan (`docs/architecture/architecture-review.html`) to resolve it. See [ADR-0002](decisions/0002-deferred-shopify-privacy-erasure.md) for the full model inventory and required scope.

## Item 2 detail — deployment constraint

**Horizontal scaling (more than one running instance of this application) must remain disabled** until the job-processing mechanism is replaced or strengthened per [ADR-0001](decisions/0001-single-instance-job-execution.md). This must be stated explicitly in the Milestone 23 deployment documentation, not left implicit.

## Item 13 detail — deployment constraint

**This application must also not be deployed to more than one instance, or to a platform without a guaranteed-persistent local disk, until the proof-file storage layer is migrated to Cloudflare R2** per [ADR-0004](decisions/0004-interim-local-disk-proof-storage.md). This compounds — does not replace — item 2's existing single-instance requirement.
