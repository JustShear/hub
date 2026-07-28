-- AlterTable
ALTER TABLE "ShopifyLineProperty" ADD COLUMN     "rawValue" JSONB,
ADD COLUMN     "sortOrder" INTEGER;

-- AlterTable
ALTER TABLE "ShopifyOrder" ADD COLUMN     "billingAddress" JSONB,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "discountCodes" JSONB,
ADD COLUMN     "fulfillments" JSONB,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "noteFromCustomer" TEXT,
ADD COLUMN     "shippingAddress" JSONB,
ADD COLUMN     "shippingMethod" TEXT,
ADD COLUMN     "shopifyLegacyOrderId" TEXT,
ADD COLUMN     "shopifyUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "subtotalPrice" DECIMAL(12,2),
ADD COLUMN     "totalDiscounts" DECIMAL(12,2),
ADD COLUMN     "totalPrice" DECIMAL(12,2),
ADD COLUMN     "totalTax" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ShopifyOrderLine" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "discountAllocations" JSONB,
ADD COLUMN     "fulfilledQuantity" INTEGER,
ADD COLUMN     "shopifyProductGid" TEXT,
ADD COLUMN     "shopifyVariantGid" TEXT;

-- AlterTable
ALTER TABLE "ShopifySyncJob" ADD COLUMN     "nextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ShopifySyncJob_status_nextRetryAt_idx" ON "ShopifySyncJob"("status", "nextRetryAt");
