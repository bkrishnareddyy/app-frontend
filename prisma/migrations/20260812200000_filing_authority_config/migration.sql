-- AlterTable
ALTER TABLE "CustomsFiling" ALTER COLUMN "authority" DROP DEFAULT,
ALTER COLUMN "entryType" DROP DEFAULT,
ALTER COLUMN "filingType" DROP DEFAULT;

-- CreateTable
CREATE TABLE "FilingAuthorityConfig" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "authorityName" TEXT NOT NULL,
    "filingSystemLabel" TEXT NOT NULL,

    CONSTRAINT "FilingAuthorityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilingAuthorityConfig_country_key" ON "FilingAuthorityConfig"("country");

-- CreateIndex
CREATE UNIQUE INDEX "CustomsFiling_accountId_entryNumber_key" ON "CustomsFiling"("accountId", "entryNumber");

-- CreateIndex
CREATE INDEX "ShipmentEventLog_createdAt_idx" ON "ShipmentEventLog"("createdAt");

-- RenameIndex
ALTER INDEX "AiUsageWindow_accountId_userId_surface_windowKind_windowStart_k" RENAME TO "AiUsageWindow_accountId_userId_surface_windowKind_windowSta_key";
