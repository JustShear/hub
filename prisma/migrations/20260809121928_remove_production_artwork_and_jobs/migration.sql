-- DropForeignKey
ALTER TABLE "ExceptionCaseResolution" DROP CONSTRAINT "ExceptionCaseResolution_exportBatchId_fkey";

-- DropForeignKey
ALTER TABLE "ExportBatch" DROP CONSTRAINT "ExportBatch_orderId_fkey";

-- DropForeignKey
ALTER TABLE "ExportBatch" DROP CONSTRAINT "ExportBatch_previousBatchId_fkey";

-- DropForeignKey
ALTER TABLE "ExportBatchItem" DROP CONSTRAINT "ExportBatchItem_exportBatchId_fkey";

-- DropForeignKey
ALTER TABLE "ExportBatchItem" DROP CONSTRAINT "ExportBatchItem_productionArtworkId_fkey";

-- DropForeignKey
ALTER TABLE "ExportBatchItem" DROP CONSTRAINT "ExportBatchItem_proofGroupId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionArtwork" DROP CONSTRAINT "ProductionArtwork_proofGroupId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionArtwork" DROP CONSTRAINT "ProductionArtwork_sourceProofVersionId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionArtwork" DROP CONSTRAINT "ProductionArtwork_supersededByArtworkId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionArtworkOrderLine" DROP CONSTRAINT "ProductionArtworkOrderLine_orderLineId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionArtworkOrderLine" DROP CONSTRAINT "ProductionArtworkOrderLine_productionArtworkId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionIssue" DROP CONSTRAINT "ProductionIssue_orderId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionIssue" DROP CONSTRAINT "ProductionIssue_productionJobId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionIssue" DROP CONSTRAINT "ProductionIssue_productionTaskId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionIssueAttachment" DROP CONSTRAINT "ProductionIssueAttachment_issueId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionJob" DROP CONSTRAINT "ProductionJob_exportBatchId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionJob" DROP CONSTRAINT "ProductionJob_orderId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionNote" DROP CONSTRAINT "ProductionNote_productionJobId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionNote" DROP CONSTRAINT "ProductionNote_productionTaskId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionQualityCheck" DROP CONSTRAINT "ProductionQualityCheck_productionTaskId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionQualityCheckAttachment" DROP CONSTRAINT "ProductionQualityCheckAttachment_qualityCheckId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionQuantityUpdate" DROP CONSTRAINT "ProductionQuantityUpdate_productionTaskId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionTask" DROP CONSTRAINT "ProductionTask_dependsOnTaskId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionTask" DROP CONSTRAINT "ProductionTask_exportBatchItemId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionTask" DROP CONSTRAINT "ProductionTask_productionArtworkId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionTask" DROP CONSTRAINT "ProductionTask_productionJobId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionTask" DROP CONSTRAINT "ProductionTask_proofGroupId_fkey";

-- DropIndex
DROP INDEX "ShopifyOrder_shopId_productionSummary_idx";

-- AlterTable
ALTER TABLE "ExceptionCaseResolution" DROP COLUMN "exportBatchId";

-- AlterTable
ALTER TABLE "ShopifyOrder" DROP COLUMN "productionSummary";

-- DropTable
DROP TABLE "ExportBatch";

-- DropTable
DROP TABLE "ExportBatchItem";

-- DropTable
DROP TABLE "ProductionArtwork";

-- DropTable
DROP TABLE "ProductionArtworkOrderLine";

-- DropTable
DROP TABLE "ProductionIssue";

-- DropTable
DROP TABLE "ProductionIssueAttachment";

-- DropTable
DROP TABLE "ProductionJob";

-- DropTable
DROP TABLE "ProductionNote";

-- DropTable
DROP TABLE "ProductionQualityCheck";

-- DropTable
DROP TABLE "ProductionQualityCheckAttachment";

-- DropTable
DROP TABLE "ProductionQuantityUpdate";

-- DropTable
DROP TABLE "ProductionTask";

-- DropEnum
DROP TYPE "ColourMode";

-- DropEnum
DROP TYPE "ExportBatchStatus";

-- DropEnum
DROP TYPE "OrderProductionSummary";

-- DropEnum
DROP TYPE "ProductionArtworkStatus";

-- DropEnum
DROP TYPE "ProductionIssueStatus";

-- DropEnum
DROP TYPE "ProductionIssueType";

-- DropEnum
DROP TYPE "ProductionJobStatus";

-- DropEnum
DROP TYPE "ProductionTaskStatus";

-- DropEnum
DROP TYPE "ProductionTaskType";

