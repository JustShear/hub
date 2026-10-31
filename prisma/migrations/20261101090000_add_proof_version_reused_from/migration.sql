-- AlterTable
ALTER TABLE "ProofVersion" ADD COLUMN "reusedFromVersionId" TEXT;

-- CreateIndex
CREATE INDEX "ProofVersion_reusedFromVersionId_idx" ON "ProofVersion"("reusedFromVersionId");
