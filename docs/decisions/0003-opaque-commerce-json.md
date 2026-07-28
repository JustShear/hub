# ADR-0003: Opaque JSON storage for addresses, discounts and fulfilments

**Status:** Accepted for current milestone. Revisit when operational needs require querying into these values.

## Context

`ShopifyOrder.shippingAddress`, `billingAddress`, `discountCodes`, and `fulfillments` are stored as `Json` columns rather than normalised relational structures (separate `Address`, `Discount`, `Fulfillment` models with queryable columns). Milestone 04 only needs to preserve and later display this data — nothing in Stage One filters, searches, or aggregates by address, discount, or fulfilment fields.

## Decision

Keep these as opaque JSON snapshots of what Shopify sent. Do not normalise pre-emptively.

## Current limitations

- Cannot filter or search orders by any address field (postcode, suburb, country) at the database level without a full JSON-path query, which doesn't use an index.
- Cannot build postcode/location-based freight rules, report on discount-code usage, or query individual fulfilment lines/parcels without deserialising the JSON in application code first.
- No shipping-recommendation or operational-analytics feature can be built directly against these fields as they stand.

## Risks

- If a future milestone needs any of the above and normalisation hasn't happened yet, that milestone will be blocked on a schema migration it didn't originally scope for.
- Low risk of the JSON shape silently drifting from what the rest of the app expects, since nothing currently parses these fields beyond storing/displaying them verbatim.

## Conditions that trigger reconsideration

Normalise when the application needs to:
- Filter or search orders by address fields.
- Build postcode- or location-based freight rules (Stage Three, Starshipit integration).
- Report on discount-code usage.
- Query fulfilment lines or parcel data individually.
- Calculate shipping recommendations.
- Perform operational analytics over any of these values.

## Required future work, when triggered

- Preserve the original raw Shopify representation (do not remove the JSON snapshot — it remains the audit-complete record).
- Add queryable columns or related models **only** for the specific fields an actual feature needs — not a full speculative re-model of Shopify's address/discount/fulfilment schema.
- Write a backfill migration that populates the new columns from the existing JSON for all historical rows.
- Avoid duplicating Shopify-owned data without a clear operational need driving it — the same "don't build ahead of the milestone that needs it" discipline used throughout this project.
