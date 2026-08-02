-- AlterTable
ALTER TABLE "SavedView" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'board';

-- CreateIndex
CREATE INDEX "SavedView_staffUserId_scope_idx" ON "SavedView"("staffUserId", "scope");
