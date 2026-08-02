-- CreateTable
CREATE TABLE "ProductionQuantityUpdate" (
    "id" TEXT NOT NULL,
    "productionTaskId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "newlyProducedQuantity" INTEGER NOT NULL DEFAULT 0,
    "newlyFailedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reworkedQuantity" INTEGER NOT NULL DEFAULT 0,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "staffUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionQuantityUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionQuantityUpdate_productionTaskId_idempotencyKey_key" ON "ProductionQuantityUpdate"("productionTaskId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ProductionQuantityUpdate" ADD CONSTRAINT "ProductionQuantityUpdate_productionTaskId_fkey" FOREIGN KEY ("productionTaskId") REFERENCES "ProductionTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

