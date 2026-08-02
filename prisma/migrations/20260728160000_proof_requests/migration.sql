-- CreateEnum
CREATE TYPE "ProofRequestStatus" AS ENUM ('SENT', 'VIEWED', 'PARTIALLY_RESPONDED', 'COMPLETED', 'REVOKED', 'SUPERSEDED');

-- DropForeignKey
ALTER TABLE "ProofReminder" DROP CONSTRAINT "ProofReminder_proofVersionId_fkey";

-- DropIndex
DROP INDEX "ProofVersion_secureTokenHash_key";

-- AlterTable
ALTER TABLE "CustomerProofResponse" ADD COLUMN     "proofRequestId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "KlaviyoDispatch" ADD COLUMN     "proofRequestId" TEXT;

-- AlterTable
ALTER TABLE "ProofReminder" DROP COLUMN "proofVersionId",
ADD COLUMN     "proofRequestId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ProofVersion" DROP COLUMN "secureTokenHash",
DROP COLUMN "tokenExpiresAt",
DROP COLUMN "tokenRevokedAt";

-- CreateTable
CREATE TABLE "ProofRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "revokedByStaffId" TEXT,
    "status" "ProofRequestStatus" NOT NULL DEFAULT 'SENT',
    "staffMessage" TEXT,
    "createdByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProofRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofRequestGroup" (
    "id" TEXT NOT NULL,
    "proofRequestId" TEXT NOT NULL,
    "proofGroupId" TEXT NOT NULL,
    "proofVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofRequestGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProofRequest_tokenHash_key" ON "ProofRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "ProofRequest_shopId_orderId_idx" ON "ProofRequest"("shopId", "orderId");

-- CreateIndex
CREATE INDEX "ProofRequest_tokenExpiresAt_idx" ON "ProofRequest"("tokenExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProofRequestGroup_proofRequestId_proofGroupId_key" ON "ProofRequestGroup"("proofRequestId", "proofGroupId");

-- CreateIndex
CREATE INDEX "CustomerProofResponse_proofRequestId_idx" ON "CustomerProofResponse"("proofRequestId");

-- CreateIndex
CREATE INDEX "KlaviyoDispatch_proofRequestId_idx" ON "KlaviyoDispatch"("proofRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofReminder_proofRequestId_key" ON "ProofReminder"("proofRequestId");

-- AddForeignKey
ALTER TABLE "CustomerProofResponse" ADD CONSTRAINT "CustomerProofResponse_proofRequestId_fkey" FOREIGN KEY ("proofRequestId") REFERENCES "ProofRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRequest" ADD CONSTRAINT "ProofRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRequestGroup" ADD CONSTRAINT "ProofRequestGroup_proofRequestId_fkey" FOREIGN KEY ("proofRequestId") REFERENCES "ProofRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRequestGroup" ADD CONSTRAINT "ProofRequestGroup_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRequestGroup" ADD CONSTRAINT "ProofRequestGroup_proofVersionId_fkey" FOREIGN KEY ("proofVersionId") REFERENCES "ProofVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofReminder" ADD CONSTRAINT "ProofReminder_proofRequestId_fkey" FOREIGN KEY ("proofRequestId") REFERENCES "ProofRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KlaviyoDispatch" ADD CONSTRAINT "KlaviyoDispatch_proofRequestId_fkey" FOREIGN KEY ("proofRequestId") REFERENCES "ProofRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

