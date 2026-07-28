# Decision log

Chronological record of significant decisions. Full reasoning for each lives in its linked ADR (`docs/decisions/`) where one exists; this log is the short, dated index.

| Date | Decision | Detail |
| --- | --- | --- |
| 2026-07-26 | Standalone app, independent staff auth, no embedded Shopify admin app | SRS v1.1 change log, Section 1.3 |
| 2026-07-26 | Customer email via Klaviyo (profile + event tracking), not a transactional provider | SRS v1.1 change log, Section 1.3 |
| 2026-07-27 | Prisma pinned to 6.19.3 instead of latest 7.x | Avoids two disclosed vulnerabilities in 7.x's bundled dev-database tooling; no functional loss for this app's usage |
| 2026-07-27 | Prisma client `engineType = "binary"` | Dev machine is Windows ARM64; the default "library" engine is an x64 native addon that can't load into an arm64 Node process |
| 2026-07-27 | Single in-process job poller, not a distributed queue | [ADR-0001](decisions/0001-single-instance-job-execution.md) — **acceptable only for single-instance deployment** |
| 2026-07-27 | Deferred full automated `shop/redact` / complete `customers/redact` | [ADR-0002](decisions/0002-deferred-shopify-privacy-erasure.md) — **BLOCKING BEFORE PRODUCTION**, dedicated future milestone required |
| 2026-07-27 | Opaque JSON for addresses/discounts/fulfilments, not normalised | [ADR-0003](decisions/0003-opaque-commerce-json.md) — revisit when an operational feature needs to query into these |
| 2026-07-27 | Added proposed Milestone "Privacy, Retention and Shopify Data Erasure" | See `docs/architecture/architecture-review.html` milestone plan; must complete before production go-live |
| 2026-07-28 | Interim local-disk proof-file storage behind a provider-agnostic `StorageAdapter`, not Cloudflare R2 | [ADR-0004](decisions/0004-interim-local-disk-proof-storage.md) — **must be replaced before production go-live**, and compounds ADR-0001's single-instance constraint until then |
| 2026-07-28 | Reused `OrderProofSummary.PROOFS_NOT_STARTED` for both "undetermined" and "no proofs created yet"; added only `READY_TO_SEND`/`BLOCKED` as genuinely new enum values | Avoids a breaking rename across Milestones 06B/07 code for a distinction with no behavioural difference this milestone; see `docs/development.md` "Proof groups and proof versions (Milestone 08)" |
| 2026-07-28 | Mapped the milestone's 3-value proof-requirement vocabulary onto the schema's existing 4-value `ProofRequirementValue` enum, leaving `PARTIALLY_REQUIRED` reachable-but-unused | Avoids a schema rename; `PARTIALLY_REQUIRED` is reserved for a later milestone once a group can span lines with genuinely different requirement decisions |

See also `docs/technical-debt.md` for the register of open items with status/severity, and `docs/development.md` for per-milestone implementation notes.
