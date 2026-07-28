-- CreateEnum
CREATE TYPE "ArtworkAssetSourceType" AS ENUM ('EXTERNAL_REFERENCE', 'STORED');

-- AlterTable
ALTER TABLE "CustomerArtworkAsset" ADD COLUMN     "parsingUncertain" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceType" "ArtworkAssetSourceType" NOT NULL DEFAULT 'EXTERNAL_REFERENCE',
ADD COLUMN     "sourceUrl" TEXT,
ALTER COLUMN "storageKey" DROP NOT NULL,
ALTER COLUMN "mimeType" DROP NOT NULL,
ALTER COLUMN "sizeBytes" DROP NOT NULL;
