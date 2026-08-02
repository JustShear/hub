-- CreateEnum
CREATE TYPE "OrderProductionSummary" AS ENUM ('NOT_READY', 'READY_FOR_PRODUCTION', 'QUEUED', 'IN_PROGRESS', 'PARTIALLY_COMPLETE', 'BLOCKED', 'AWAITING_QUALITY_CHECK', 'COMPLETE');

-- CreateEnum
CREATE TYPE "ProductionJobStatus" AS ENUM ('QUEUED', 'READY', 'IN_PROGRESS', 'PAUSED', 'BLOCKED', 'AWAITING_QUALITY_CHECK', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionTaskStatus" AS ENUM ('QUEUED', 'READY', 'IN_PROGRESS', 'PAUSED', 'BLOCKED', 'PARTIALLY_COMPLETE', 'AWAITING_QUALITY_CHECK', 'COMPLETE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionTaskType" AS ENUM ('PRINT', 'PRESS', 'EMBROIDER', 'SUBLIMATE', 'VINYL_APPLY', 'UNPRINTED_PREP', 'EXTERNAL_PRODUCTION', 'QUALITY_CHECK', 'GENERAL');

-- CreateEnum
CREATE TYPE "ProductionIssueType" AS ENUM ('ARTWORK_PROBLEM', 'WRONG_FILE', 'WRONG_PLACEMENT', 'WRONG_COLOUR', 'GARMENT_DAMAGE', 'PRINT_DEFECT', 'EMBROIDERY_DEFECT', 'EQUIPMENT_ISSUE', 'STOCK_SHORTAGE', 'QUANTITY_DISCREPANCY', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductionIssueStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'WAITING', 'RESOLVED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OverrideType" ADD VALUE 'REOPEN_COMPLETED_PRODUCTION';
ALTER TYPE "OverrideType" ADD VALUE 'OVERRIDE_PRODUCTION_QUANTITY';

-- AlterTable
ALTER TABLE "ShopifyOrder" ADD COLUMN     "productionSummary" "OrderProductionSummary" NOT NULL DEFAULT 'NOT_READY';

-- CreateTable
CREATE TABLE "ProductionJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "exportBatchId" TEXT NOT NULL,
    "jobNumber" INTEGER NOT NULL,
    "decorationMethod" "DecorationMethod" NOT NULL,
    "status" "ProductionJobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "dueDate" TIMESTAMP(3),
    "assignedStaffId" TEXT,
    "assignedTeam" TEXT,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "qualityCheckedAt" TIMESTAMP(3),
    "completedByStaffId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "reopenedByStaffId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledByStaffId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionTask" (
    "id" TEXT NOT NULL,
    "productionJobId" TEXT NOT NULL,
    "proofGroupId" TEXT NOT NULL,
    "exportBatchItemId" TEXT NOT NULL,
    "productionArtworkId" TEXT NOT NULL,
    "taskType" "ProductionTaskType" NOT NULL DEFAULT 'GENERAL',
    "decorationMethod" "DecorationMethod" NOT NULL,
    "placement" TEXT,
    "status" "ProductionTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "assignedStaffId" TEXT,
    "requiredQuantity" INTEGER NOT NULL,
    "completedQuantity" INTEGER NOT NULL DEFAULT 0,
    "failedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reworkQuantity" INTEGER NOT NULL DEFAULT 0,
    "qualityApprovedQuantity" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "totalPausedDurationMs" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedByStaffId" TEXT,
    "productionInstructions" TEXT,
    "sequenceOrder" INTEGER NOT NULL DEFAULT 0,
    "dependsOnTaskId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "reopenedByStaffId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledByStaffId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionQualityCheck" (
    "id" TEXT NOT NULL,
    "productionTaskId" TEXT NOT NULL,
    "checkedQuantity" INTEGER NOT NULL,
    "approvedQuantity" INTEGER NOT NULL,
    "failedQuantity" INTEGER NOT NULL,
    "checklistResult" JSONB,
    "notes" TEXT,
    "failureReason" TEXT,
    "reworkRequired" BOOLEAN NOT NULL DEFAULT false,
    "checkedByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionQualityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionQualityCheckAttachment" (
    "id" TEXT NOT NULL,
    "qualityCheckId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionQualityCheckAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionIssue" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productionJobId" TEXT NOT NULL,
    "productionTaskId" TEXT,
    "proofGroupId" TEXT,
    "productionArtworkId" TEXT,
    "issueType" "ProductionIssueType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "ProductionIssueStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "reworkQuantity" INTEGER,
    "createdByStaffId" TEXT NOT NULL,
    "assignedStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByStaffId" TEXT,
    "resolution" TEXT,

    CONSTRAINT "ProductionIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionIssueAttachment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionIssueAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionNote" (
    "id" TEXT NOT NULL,
    "productionJobId" TEXT,
    "productionTaskId" TEXT,
    "authorStaffId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionJob_shopId_status_idx" ON "ProductionJob"("shopId", "status");

-- CreateIndex
CREATE INDEX "ProductionJob_assignedStaffId_idx" ON "ProductionJob"("assignedStaffId");

-- CreateIndex
CREATE INDEX "ProductionJob_dueDate_idx" ON "ProductionJob"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionJob_exportBatchId_decorationMethod_key" ON "ProductionJob"("exportBatchId", "decorationMethod");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionJob_orderId_jobNumber_key" ON "ProductionJob"("orderId", "jobNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionTask_exportBatchItemId_key" ON "ProductionTask"("exportBatchItemId");

-- CreateIndex
CREATE INDEX "ProductionTask_productionJobId_status_idx" ON "ProductionTask"("productionJobId", "status");

-- CreateIndex
CREATE INDEX "ProductionTask_assignedStaffId_idx" ON "ProductionTask"("assignedStaffId");

-- CreateIndex
CREATE INDEX "ProductionTask_proofGroupId_idx" ON "ProductionTask"("proofGroupId");

-- CreateIndex
CREATE INDEX "ProductionIssue_productionJobId_status_idx" ON "ProductionIssue"("productionJobId", "status");

-- CreateIndex
CREATE INDEX "ProductionIssue_productionTaskId_status_idx" ON "ProductionIssue"("productionTaskId", "status");

-- CreateIndex
CREATE INDEX "ProductionIssue_orderId_idx" ON "ProductionIssue"("orderId");

-- CreateIndex
CREATE INDEX "ProductionNote_productionJobId_idx" ON "ProductionNote"("productionJobId");

-- CreateIndex
CREATE INDEX "ProductionNote_productionTaskId_idx" ON "ProductionNote"("productionTaskId");

-- CreateIndex
CREATE INDEX "ShopifyOrder_shopId_productionSummary_idx" ON "ShopifyOrder"("shopId", "productionSummary");

-- AddForeignKey
ALTER TABLE "ProductionJob" ADD CONSTRAINT "ProductionJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionJob" ADD CONSTRAINT "ProductionJob_exportBatchId_fkey" FOREIGN KEY ("exportBatchId") REFERENCES "ExportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_productionJobId_fkey" FOREIGN KEY ("productionJobId") REFERENCES "ProductionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_exportBatchItemId_fkey" FOREIGN KEY ("exportBatchItemId") REFERENCES "ExportBatchItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_productionArtworkId_fkey" FOREIGN KEY ("productionArtworkId") REFERENCES "ProductionArtwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "ProductionTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionQualityCheck" ADD CONSTRAINT "ProductionQualityCheck_productionTaskId_fkey" FOREIGN KEY ("productionTaskId") REFERENCES "ProductionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionQualityCheckAttachment" ADD CONSTRAINT "ProductionQualityCheckAttachment_qualityCheckId_fkey" FOREIGN KEY ("qualityCheckId") REFERENCES "ProductionQualityCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionIssue" ADD CONSTRAINT "ProductionIssue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionIssue" ADD CONSTRAINT "ProductionIssue_productionJobId_fkey" FOREIGN KEY ("productionJobId") REFERENCES "ProductionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionIssue" ADD CONSTRAINT "ProductionIssue_productionTaskId_fkey" FOREIGN KEY ("productionTaskId") REFERENCES "ProductionTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionIssueAttachment" ADD CONSTRAINT "ProductionIssueAttachment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ProductionIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionNote" ADD CONSTRAINT "ProductionNote_productionJobId_fkey" FOREIGN KEY ("productionJobId") REFERENCES "ProductionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionNote" ADD CONSTRAINT "ProductionNote_productionTaskId_fkey" FOREIGN KEY ("productionTaskId") REFERENCES "ProductionTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

