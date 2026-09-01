-- CreateEnum
CREATE TYPE "CardTintOverride" AS ENUM ('PINK', 'BLUE', 'NONE');

-- AlterTable
ALTER TABLE "ShopifyOrder" ADD COLUMN     "cardTintOverride" "CardTintOverride";

-- Backfill: preserve every order currently manually flagged as needing
-- printing — it keeps forcing the same pink tint under the new field.
UPDATE "ShopifyOrder" SET "cardTintOverride" = 'PINK' WHERE "needsPrinting" = true;

-- AlterTable
ALTER TABLE "ShopifyOrder" DROP COLUMN "needsPrinting";
