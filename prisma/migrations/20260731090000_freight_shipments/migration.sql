
-- CreateEnum
CREATE TYPE "FreightShipmentStatus" AS ENUM ('PREPARING', 'CREATED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "FreightShipment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "FreightShipmentStatus" NOT NULL DEFAULT 'PREPARING',
    "idempotencyKey" TEXT NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "carrierServiceCode" TEXT NOT NULL,
    "packagingPresetName" TEXT,
    "starshipitOrderId" TEXT,
    "carrierName" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "labelStorageKey" TEXT,
    "labelChecksum" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadedAt" TIMESTAMP(3),
    "shopifyFulfillmentId" TEXT,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledByStaffId" TEXT,

    CONSTRAINT "FreightShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FreightShipment_idempotencyKey_key" ON "FreightShipment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FreightShipment_shopId_status_idx" ON "FreightShipment"("shopId", "status");

-- CreateIndex
CREATE INDEX "FreightShipment_orderId_status_idx" ON "FreightShipment"("orderId", "status");

-- AddForeignKey
ALTER TABLE "FreightShipment" ADD CONSTRAINT "FreightShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

