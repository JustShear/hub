-- AlterTable
ALTER TABLE "ProofAsset" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "originalFilename" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "uploadedByStaffId" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "ProofGroup" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByStaffId" TEXT,
ADD COLUMN     "name" TEXT NOT NULL,
ALTER COLUMN "placement" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProofVersion" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledByStaffId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "supersededByVersionId" TEXT;

-- CreateTable
CREATE TABLE "ProofGroupArtworkAsset" (
    "id" TEXT NOT NULL,
    "proofGroupId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "linkedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofGroupArtworkAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofNote" (
    "id" TEXT NOT NULL,
    "proofGroupId" TEXT,
    "proofVersionId" TEXT,
    "authorStaffId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofVersionSourceAsset" (
    "id" TEXT NOT NULL,
    "proofVersionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofVersionSourceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProofGroupArtworkAsset_proofGroupId_assetId_key" ON "ProofGroupArtworkAsset"("proofGroupId", "assetId");

-- CreateIndex
CREATE INDEX "ProofNote_proofGroupId_idx" ON "ProofNote"("proofGroupId");

-- CreateIndex
CREATE INDEX "ProofNote_proofVersionId_idx" ON "ProofNote"("proofVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofVersionSourceAsset_proofVersionId_assetId_key" ON "ProofVersionSourceAsset"("proofVersionId", "assetId");

-- CreateIndex
CREATE INDEX "ProofGroup_assignedStaffId_idx" ON "ProofGroup"("assignedStaffId");

-- CreateIndex
CREATE INDEX "ProofGroup_dueDate_idx" ON "ProofGroup"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProofVersion_idempotencyKey_key" ON "ProofVersion"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProofVersion_supersededByVersionId_key" ON "ProofVersion"("supersededByVersionId");

-- AddForeignKey
ALTER TABLE "ProofGroupArtworkAsset" ADD CONSTRAINT "ProofGroupArtworkAsset_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofGroupArtworkAsset" ADD CONSTRAINT "ProofGroupArtworkAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CustomerArtworkAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofNote" ADD CONSTRAINT "ProofNote_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofNote" ADD CONSTRAINT "ProofNote_proofVersionId_fkey" FOREIGN KEY ("proofVersionId") REFERENCES "ProofVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersion" ADD CONSTRAINT "ProofVersion_supersededByVersionId_fkey" FOREIGN KEY ("supersededByVersionId") REFERENCES "ProofVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersionSourceAsset" ADD CONSTRAINT "ProofVersionSourceAsset_proofVersionId_fkey" FOREIGN KEY ("proofVersionId") REFERENCES "ProofVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersionSourceAsset" ADD CONSTRAINT "ProofVersionSourceAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CustomerArtworkAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

