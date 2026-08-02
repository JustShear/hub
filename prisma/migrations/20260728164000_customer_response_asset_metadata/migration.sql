-- AlterTable
ALTER TABLE "CustomerResponseAsset" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "originalFilename" TEXT,
ADD COLUMN     "sizeBytes" INTEGER;
