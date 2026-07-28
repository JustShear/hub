# ADR-0002: Deferred Shopify privacy/data-erasure workflow

**Status:** BLOCKING BEFORE PRODUCTION. This is not optional technical debt — the application must not be approved for live production use until the work described here is designed, implemented and tested.

## Context

Shopify requires three mandatory compliance webhooks: `customers/data_request`, `customers/redact`, and `shop/redact`. Milestone 04 built the receiving endpoints for all three, verified and idempotent, but deliberately did **not** build full automated data erasure:

- `customers/data_request` records the request for manual fulfilment (Shopify expects the merchant to separately provide the data, not an automated payload response via the webhook itself).
- `customers/redact` performs a **partial, real** action: it anonymises `ShopifyOrder.customerEmail`/`customerName`/`customerPhone`/`shippingAddress`/`billingAddress` for matching orders. It does **not** touch the other models listed below that may also carry that customer's data (proof messages, artwork, activity history, Klaviyo dispatch records, raw payloads, etc.).
- `shop/redact` currently only logs receipt for manual review. It performs **no automated deletion or anonymisation** of any kind.

This was a deliberate scope decision, not an oversight: safely erasing or anonymising data spread across ~30 interconnected models — some of which exist specifically to preserve immutable audit history (`ActivityEvent`, `IntegrationFailure`) — is a design problem in its own right. Shipping a rushed partial-deletion pass risked either leaving PII behind (compliance failure) or destroying operational/audit records the SRS explicitly requires to be preserved (e.g. "never overwrite prior proofs, approvals, customer responses or production records" — SRS Appendix C). Doing it properly needs its own milestone.

## Decision

1. Defer full automated `shop/redact` (and the remaining scope of `customers/redact`) to a dedicated future milestone: **"Privacy, Retention and Shopify Data Erasure."**
2. Mark this a **production-readiness blocker**, not routine technical debt.
3. Keep the current webhook handlers as they are (verify, acknowledge, record for manual follow-up) — safe, honest, and not making false claims about completeness — rather than building a rushed partial solution now.
4. Ensure the handlers' own activity records and any tracked failures state plainly that manual/incomplete action was taken, so nothing downstream can mistake "webhook returned 200" for "data was erased."

## Every current model that may contain shop, customer, order, upload, email, proof, activity, raw-payload or integration data

This inventory is the starting scope for the future milestone — not a claim that all of it is already handled.

| Model | Category | Contains |
| --- | --- | --- |
| `Shop` | Shop | `adminApiToken` (secret), `shopifyDomain`, `scopes` |
| `AppSetting` | Shop config | Arbitrary shop-level JSON config |
| `DecorationTemplate` | Shop config | Wording templates (not customer data) |
| `Barcode` | Shop config | Barcode identities (not customer data) |
| `ShopifyOrder` | Order / customer | `customerEmail`, `customerName`, `customerPhone`, `shippingAddress`, `billingAddress`, `noteFromCustomer`, **`rawPayload` (full raw Shopify order — embeds all of the above again, unredacted, inside the JSON blob)** |
| `ShopifyOrderLine` | Order | Product/variant/quantity data — not customer PII directly |
| `ShopifyLineProperty` | Order / upload | `value`/`rawValue` may contain customer-entered text or uploaded-file URLs (OPTIS custom attributes) |
| `CustomerArtworkAsset` | Upload | `sourceUrl`, `originalFilename` — may embed customer-identifying info in the URL/filename |
| `ArtworkOrderLineLink` | Upload | Links assets to lines — no PII itself |
| `ProofRequirement` | Proof | `reasonNote` — could reference customer specifics |
| `ProofGroup` / `ProofGroupOrderLine` | Proof | Decoration/placement metadata — not customer PII |
| `ProofVersion` | Proof | `customerMessage` — staff-authored but customer-facing, may reference the customer |
| `ProofAsset` | Proof / upload | `storageKey` — proof images, may depict customer-provided artwork |
| `CustomerProofResponse` | Proof / customer | `customerNote`, **`requestIp`, `requestUserAgent`** — IP address is itself personal data |
| `CustomerResponseAsset` | Proof / upload | Customer-uploaded files attached to a response |
| `ProductionExport` | Proof | `internalNote` — staff-authored, unlikely but possible customer reference |
| `ProofReminder` | Email / proof | Scheduling metadata — no direct PII |
| `KlaviyoDispatch` | Email | `recipientEmail`, **`eventProperties` (Json — merge fields, likely includes customer name/order number)** |
| `ActivityEvent` | Activity / audit | `summary`, `metadata` (Json) — may reference customer email/name in human-readable form (several of this milestone's own activity events do exactly this) |
| `OrderNote` | Activity | `body` — staff-authored, may quote customer communications |
| `Notification` | Activity | Staff-facing; `relatedEntityId` may reference customer-linked records |
| `OrderAssignment` / `OrderDueDate` / `OrderPriorityHistory` | Workflow | Operational metadata, not customer PII |
| `ManualOverride` / `ManualOverrideAttachment` | Audit | `reason`, `previousValue`/`newValue` (Json) could reference customer specifics |
| `ShopifySyncJob` | Integration | `payload` (Json) — currently just `{shopifyOrderGid}`, low risk but not zero |
| `IntegrationFailure` / `IntegrationAttempt` | Integration | `summary`, `technicalDetail` — sanitised of secrets by convention, but not guaranteed free of customer identifiers (e.g. this milestone's own failure summaries can include an order GID) |
| `Reprint` / `ReprintAsset` | Order | `explanation` — staff-authored, may reference customer specifics |
| `ScanEvent` | Warehouse | Barcode/station data — not customer PII |
| `SavedView` | Staff | Staff-only filters — not customer data |
| `StaffUser`, `Role`, `Permission`, `RolePermission`, `StaffRole` | Access control | Staff data, not customer data — likely **out of scope** for `customers/redact`/`shop/redact`, but `shop/redact` (full shop erasure after uninstall) needs an explicit decision on whether staff accounts are removed too |

## Risks

- **Compliance risk**: as currently built, a `customers/redact` request does not fully remove that customer's PII from the system — it's present in `ShopifyOrder.rawPayload`, `ProofVersion.customerMessage`, `CustomerProofResponse.requestIp`, `KlaviyoDispatch.eventProperties`, `ActivityEvent.summary`/`metadata`, and potentially others in the table above.
- **`shop/redact` compliance risk** is total: nothing is currently erased automatically when a shop's data-erasure window arrives.
- **Reputational/legal risk** if this ships to a real store before the dedicated milestone is complete.

## Conditions that trigger reconsideration

- Any plan to onboard a real Shopify store with real customer data.
- Any real `customers/redact` or `shop/redact` webhook delivery from Shopify against a live install.
- Legal/compliance review of the SRS's data-retention requirements (SRS Section 26 already flags "file retention" as an open validation item — this ADR extends that same open question to full erasure).

## Required future work

See the proposed milestone **"Privacy, Retention and Shopify Data Erasure"** (added to the architecture review's milestone plan) for full scope. At minimum it must resolve, for every model above: delete vs. anonymise, retention period, and treatment under audit-history-must-be-preserved constraints — then implement and test all three webhooks against a realistic seeded shop before this ADR can be closed.
