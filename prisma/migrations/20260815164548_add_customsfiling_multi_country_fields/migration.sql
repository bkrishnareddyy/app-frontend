-- AlterTable: Add new multi-country fields to CustomsFiling
-- These fields replace the US-centric entryType + authority approach

-- Add new fields (nullable for backwards compatibility during migration)
ALTER TABLE "CustomsFiling" ADD COLUMN "transactionTypeId" TEXT;
ALTER TABLE "CustomsFiling" ADD COLUMN "country" TEXT;
ALTER TABLE "CustomsFiling" ADD COLUMN "procedureCode" TEXT;

-- Make old fields nullable (were required before)
ALTER TABLE "CustomsFiling" ALTER COLUMN "entryType" DROP NOT NULL;
ALTER TABLE "CustomsFiling" ALTER COLUMN "authority" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CustomsFiling_country_procedureCode_idx" ON "CustomsFiling"("country", "procedureCode");

-- CreateIndex
CREATE INDEX "CustomsFiling_transactionTypeId_idx" ON "CustomsFiling"("transactionTypeId");

-- AddForeignKey
ALTER TABLE "CustomsFiling" ADD CONSTRAINT "CustomsFiling_transactionTypeId_fkey" FOREIGN KEY ("transactionTypeId") REFERENCES "FilingTransactionType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
