-- CreateEnum
CREATE TYPE "ProductionArtworkStatus" AS ENUM ('DRAFT', 'VALIDATION_FAILED', 'READY_FOR_EXPORT', 'EXPORTED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ColourMode" AS ENUM ('RGB', 'CMYK', 'SPOT', 'GREYSCALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExportBatchStatus" AS ENUM ('PREPARING', 'READY', 'EXPORTED', 'FAILED', 'SUPERSEDED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "ProductionExport" DROP CONSTRAINT "ProductionExport_proofGroupId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionExport" DROP CONSTRAINT "ProductionExport_proofVersionId_fkey";

-- DropTable
DROP TABLE "ProductionExport";

-- CreateTable
CREATE TABLE "ProductionArtwork" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "proofGroupId" TEXT NOT NULL,
    "sourceProofVersionId" TEXT,
    "sourceNoProofReasonSnapshot" "NoProofReason",
    "revisionNumber" INTEGER NOT NULL,
    "status" "ProductionArtworkStatus" NOT NULL DEFAULT 'DRAFT',
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "isPreviewable" BOOLEAN NOT NULL DEFAULT false,
    "width" INTEGER,
    "height" INTEGER,
    "dpi" INTEGER,
    "colourMode" "ColourMode",
    "decorationMethod" "DecorationMethod" NOT NULL,
    "placement" TEXT,
    "productionMetadata" JSONB,
    "validationStatus" BOOLEAN NOT NULL DEFAULT false,
    "validationMessages" JSONB,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledByStaffId" TEXT,
    "supersededByArtworkId" TEXT,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "ProductionArtwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionArtworkOrderLine" (
    "id" TEXT NOT NULL,
    "productionArtworkId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionArtworkOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportBatch" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "status" "ExportBatchStatus" NOT NULL DEFAULT 'PREPARING',
    "idempotencyKey" TEXT NOT NULL,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportedAt" TIMESTAMP(3),
    "destination" TEXT,
    "manifestSnapshot" JSONB,
    "packageStorageKey" TEXT,
    "packageChecksum" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadedAt" TIMESTAMP(3),
    "previousBatchId" TEXT,
    "reexportReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "ExportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportBatchItem" (
    "id" TEXT NOT NULL,
    "exportBatchId" TEXT NOT NULL,
    "proofGroupId" TEXT NOT NULL,
    "productionArtworkId" TEXT NOT NULL,
    "sourceProofVersionId" TEXT,
    "sourceProofVersionNumber" INTEGER,
    "sourceNoProofReasonSnapshot" "NoProofReason",
    "decorationMethodSnapshot" "DecorationMethod" NOT NULL,
    "placementSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionArtwork_supersededByArtworkId_key" ON "ProductionArtwork"("supersededByArtworkId");

-- CreateIndex
CREATE INDEX "ProductionArtwork_shopId_status_idx" ON "ProductionArtwork"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionArtwork_proofGroupId_revisionNumber_key" ON "ProductionArtwork"("proofGroupId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionArtworkOrderLine_productionArtworkId_orderLineId_key" ON "ProductionArtworkOrderLine"("productionArtworkId", "orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportBatch_idempotencyKey_key" ON "ExportBatch"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExportBatch_previousBatchId_key" ON "ExportBatch"("previousBatchId");

-- CreateIndex
CREATE INDEX "ExportBatch_shopId_status_idx" ON "ExportBatch"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExportBatch_orderId_batchNumber_key" ON "ExportBatch"("orderId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExportBatchItem_exportBatchId_proofGroupId_key" ON "ExportBatchItem"("exportBatchId", "proofGroupId");

-- AddForeignKey
ALTER TABLE "ProductionArtwork" ADD CONSTRAINT "ProductionArtwork_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionArtwork" ADD CONSTRAINT "ProductionArtwork_sourceProofVersionId_fkey" FOREIGN KEY ("sourceProofVersionId") REFERENCES "ProofVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionArtwork" ADD CONSTRAINT "ProductionArtwork_supersededByArtworkId_fkey" FOREIGN KEY ("supersededByArtworkId") REFERENCES "ProductionArtwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionArtworkOrderLine" ADD CONSTRAINT "ProductionArtworkOrderLine_productionArtworkId_fkey" FOREIGN KEY ("productionArtworkId") REFERENCES "ProductionArtwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionArtworkOrderLine" ADD CONSTRAINT "ProductionArtworkOrderLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "ShopifyOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportBatch" ADD CONSTRAINT "ExportBatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportBatch" ADD CONSTRAINT "ExportBatch_previousBatchId_fkey" FOREIGN KEY ("previousBatchId") REFERENCES "ExportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportBatchItem" ADD CONSTRAINT "ExportBatchItem_exportBatchId_fkey" FOREIGN KEY ("exportBatchId") REFERENCES "ExportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportBatchItem" ADD CONSTRAINT "ExportBatchItem_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportBatchItem" ADD CONSTRAINT "ExportBatchItem_productionArtworkId_fkey" FOREIGN KEY ("productionArtworkId") REFERENCES "ProductionArtwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

