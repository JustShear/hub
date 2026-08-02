-- CreateEnum
CREATE TYPE "OrderWarehousePickSummary" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'HANDED_OVER');

-- CreateEnum
CREATE TYPE "WarehousePickJobStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'HANDED_OVER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WarehousePickItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PICKED', 'SHORT');

-- CreateEnum
CREATE TYPE "WarehouseIssueType" AS ENUM ('STOCK_SHORTAGE', 'DAMAGED_STOCK', 'WRONG_LOCATION', 'MISSING_ITEM', 'OTHER');

-- CreateEnum
CREATE TYPE "WarehouseIssueStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'WAITING', 'RESOLVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ShopifyOrder" ADD COLUMN     "warehousePickSummary" "OrderWarehousePickSummary" NOT NULL DEFAULT 'NOT_STARTED';

-- CreateTable
CREATE TABLE "WarehousePickJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "WarehousePickJobStatus" NOT NULL DEFAULT 'QUEUED',
    "assignedStaffId" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "handedOverByStaffId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledByStaffId" TEXT,

    CONSTRAINT "WarehousePickJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehousePickItem" (
    "id" TEXT NOT NULL,
    "warehousePickJobId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "sku" TEXT,
    "productTitle" TEXT NOT NULL,
    "requiredQuantity" INTEGER NOT NULL,
    "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
    "shortQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" "WarehousePickItemStatus" NOT NULL DEFAULT 'PENDING',
    "shortReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehousePickItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehousePickQuantityUpdate" (
    "id" TEXT NOT NULL,
    "warehousePickItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehousePickQuantityUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseIssue" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "warehousePickJobId" TEXT NOT NULL,
    "warehousePickItemId" TEXT,
    "issueType" "WarehouseIssueType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "WarehouseIssueStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByStaffId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "WarehouseIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseNote" (
    "id" TEXT NOT NULL,
    "warehousePickJobId" TEXT NOT NULL,
    "authorStaffId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehousePickJob_orderId_key" ON "WarehousePickJob"("orderId");

-- CreateIndex
CREATE INDEX "WarehousePickJob_shopId_status_idx" ON "WarehousePickJob"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WarehousePickItem_warehousePickJobId_orderLineId_key" ON "WarehousePickItem"("warehousePickJobId", "orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehousePickQuantityUpdate_warehousePickItemId_idempotency_key" ON "WarehousePickQuantityUpdate"("warehousePickItemId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WarehouseIssue_warehousePickJobId_status_idx" ON "WarehouseIssue"("warehousePickJobId", "status");

-- CreateIndex
CREATE INDEX "WarehouseIssue_warehousePickItemId_status_idx" ON "WarehouseIssue"("warehousePickItemId", "status");

-- CreateIndex
CREATE INDEX "WarehouseNote_warehousePickJobId_idx" ON "WarehouseNote"("warehousePickJobId");

-- CreateIndex
CREATE INDEX "ShopifyOrder_shopId_warehousePickSummary_idx" ON "ShopifyOrder"("shopId", "warehousePickSummary");

-- AddForeignKey
ALTER TABLE "WarehousePickJob" ADD CONSTRAINT "WarehousePickJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehousePickItem" ADD CONSTRAINT "WarehousePickItem_warehousePickJobId_fkey" FOREIGN KEY ("warehousePickJobId") REFERENCES "WarehousePickJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehousePickQuantityUpdate" ADD CONSTRAINT "WarehousePickQuantityUpdate_warehousePickItemId_fkey" FOREIGN KEY ("warehousePickItemId") REFERENCES "WarehousePickItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseIssue" ADD CONSTRAINT "WarehouseIssue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseIssue" ADD CONSTRAINT "WarehouseIssue_warehousePickJobId_fkey" FOREIGN KEY ("warehousePickJobId") REFERENCES "WarehousePickJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseIssue" ADD CONSTRAINT "WarehouseIssue_warehousePickItemId_fkey" FOREIGN KEY ("warehousePickItemId") REFERENCES "WarehousePickItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseNote" ADD CONSTRAINT "WarehouseNote_warehousePickJobId_fkey" FOREIGN KEY ("warehousePickJobId") REFERENCES "WarehousePickJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

