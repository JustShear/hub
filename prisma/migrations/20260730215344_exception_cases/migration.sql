/*
  Warnings:

  - You are about to drop the `Reprint` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReprintAsset` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ExceptionCaseCategory" AS ENUM ('CUSTOMER_RETURN', 'WARRANTY_CLAIM', 'PRODUCTION_DEFECT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExceptionCaseInitiator" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "ExceptionCaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'AWAITING_CUSTOMER', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExceptionResolutionType" AS ENUM ('REPRINT', 'CREDIT', 'REFUND', 'EXCHANGE', 'DENIED');

-- CreateEnum
CREATE TYPE "ExceptionResolutionStatus" AS ENUM ('PENDING', 'COMPLETED');

-- DropForeignKey
ALTER TABLE "Reprint" DROP CONSTRAINT "Reprint_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Reprint" DROP CONSTRAINT "Reprint_proofGroupId_fkey";

-- DropForeignKey
ALTER TABLE "ReprintAsset" DROP CONSTRAINT "ReprintAsset_reprintId_fkey";

-- DropTable
DROP TABLE "Reprint";

-- DropTable
DROP TABLE "ReprintAsset";

-- DropEnum
DROP TYPE "ReprintReasonCategory";

-- DropEnum
DROP TYPE "ReprintStatus";

-- CreateTable
CREATE TABLE "ExceptionCase" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "caseNumber" INTEGER NOT NULL,
    "category" "ExceptionCaseCategory" NOT NULL,
    "initiatedBy" "ExceptionCaseInitiator" NOT NULL,
    "status" "ExceptionCaseStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "summary" TEXT NOT NULL,
    "customerNote" TEXT,
    "assignedStaffId" TEXT,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "investigationStartedAt" TIMESTAMP(3),
    "returnLabelProvidedAt" TIMESTAMP(3),
    "returnLabelNote" TEXT,
    "returnLabelProvidedByStaffId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "ExceptionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionCaseResolution" (
    "id" TEXT NOT NULL,
    "exceptionCaseId" TEXT NOT NULL,
    "resolutionType" "ExceptionResolutionType" NOT NULL,
    "status" "ExceptionResolutionStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "currencyCode" TEXT,
    "exportBatchId" TEXT,
    "decidedByStaffId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedByStaffId" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExceptionCaseResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionCaseAttachment" (
    "id" TEXT NOT NULL,
    "exceptionCaseId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionCaseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionCaseNote" (
    "id" TEXT NOT NULL,
    "exceptionCaseId" TEXT NOT NULL,
    "authorStaffId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionCaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExceptionCase_shopId_status_idx" ON "ExceptionCase"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExceptionCase_orderId_caseNumber_key" ON "ExceptionCase"("orderId", "caseNumber");

-- CreateIndex
CREATE INDEX "ExceptionCaseResolution_exceptionCaseId_idx" ON "ExceptionCaseResolution"("exceptionCaseId");

-- CreateIndex
CREATE INDEX "ExceptionCaseNote_exceptionCaseId_idx" ON "ExceptionCaseNote"("exceptionCaseId");

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCase" ADD CONSTRAINT "ExceptionCase_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "ShopifyOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCaseResolution" ADD CONSTRAINT "ExceptionCaseResolution_exceptionCaseId_fkey" FOREIGN KEY ("exceptionCaseId") REFERENCES "ExceptionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCaseResolution" ADD CONSTRAINT "ExceptionCaseResolution_exportBatchId_fkey" FOREIGN KEY ("exportBatchId") REFERENCES "ExportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCaseAttachment" ADD CONSTRAINT "ExceptionCaseAttachment_exceptionCaseId_fkey" FOREIGN KEY ("exceptionCaseId") REFERENCES "ExceptionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCaseNote" ADD CONSTRAINT "ExceptionCaseNote_exceptionCaseId_fkey" FOREIGN KEY ("exceptionCaseId") REFERENCES "ExceptionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
