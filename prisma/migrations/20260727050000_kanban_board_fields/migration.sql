-- Milestone 06B: Kanban board support.
--
-- Rollback: `ALTER TABLE "ShopifyOrder" DROP COLUMN "workflowStatusChangedAt";`
-- plus `DROP INDEX` the three indexes created below. Safe to reverse — no
-- data is destroyed by dropping these (workflowStatusChangedAt is derived
-- from createdAt for any row that predates this migration).

-- Add as nullable first so existing rows don't get an inaccurate "now()"
-- value, backfill from createdAt (accurate: no order has ever transitioned
-- status before this migration, since no workflow-change mechanism existed
-- until now), then enforce NOT NULL with a default for future inserts.
ALTER TABLE "ShopifyOrder" ADD COLUMN "workflowStatusChangedAt" TIMESTAMP(3);

UPDATE "ShopifyOrder" SET "workflowStatusChangedAt" = "createdAt" WHERE "workflowStatusChangedAt" IS NULL;

ALTER TABLE "ShopifyOrder" ALTER COLUMN "workflowStatusChangedAt" SET NOT NULL;
ALTER TABLE "ShopifyOrder" ALTER COLUMN "workflowStatusChangedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- The Kanban board's column-mapping promotion rules (Changes Requested /
-- Proof Sent) query by proofSummary directly, same access pattern as the
-- existing workflowStatus/priority indexes.
CREATE INDEX "ShopifyOrder_shopId_proofSummary_idx" ON "ShopifyOrder"("shopId", "proofSummary");

-- The board's "assigned to me" / "unassigned" filters and card assignment
-- lookups query OrderAssignment by both directions.
CREATE INDEX "OrderAssignment_orderId_idx" ON "OrderAssignment"("orderId");
CREATE INDEX "OrderAssignment_staffUserId_idx" ON "OrderAssignment"("staffUserId");
