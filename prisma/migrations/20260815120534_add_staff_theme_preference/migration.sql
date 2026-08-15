-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('CLASSIC', 'DARK', 'COLOURED_MODERN');

-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "theme" "Theme" NOT NULL DEFAULT 'CLASSIC';
