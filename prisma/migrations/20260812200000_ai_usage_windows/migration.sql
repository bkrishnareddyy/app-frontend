-- AlterTable: set default for impactFlags
ALTER TABLE "ProductChangeEvent" ALTER COLUMN "impactFlags" SET DEFAULT ARRAY[]::"ProductImpactFlag"[];

-- CreateTable: AiUsageWindow — per-surface token and request budget windows
CREATE TABLE "AiUsageWindow" (
    "id"           TEXT NOT NULL,
    "accountId"    TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "surface"      TEXT NOT NULL,
    "windowKind"   TEXT NOT NULL,
    "windowStart"  TIMESTAMP(3) NOT NULL,
    "requests"     INTEGER NOT NULL DEFAULT 0,
    "inputTokens"  BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageWindow_accountId_surface_windowKind_windowStart_idx"
  ON "AiUsageWindow"("accountId", "surface", "windowKind", "windowStart");

-- CreateIndex (unique: one row per user/surface/window)
CREATE UNIQUE INDEX "AiUsageWindow_accountId_userId_surface_windowKind_windowStart_k"
  ON "AiUsageWindow"("accountId", "userId", "surface", "windowKind", "windowStart");

-- CreateIndex
CREATE INDEX "AiUsageWindow_windowStart_idx"
  ON "AiUsageWindow"("windowStart");

-- AddForeignKey
ALTER TABLE "AiUsageWindow"
  ADD CONSTRAINT "AiUsageWindow_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: faster event-log time-range queries
CREATE INDEX "ShipmentEventLog_createdAt_idx" ON "ShipmentEventLog"("createdAt");

-- RenameIndex (truncated name for Postgres 63-char limit)
ALTER INDEX "ProductClassification_accountId_jurisdiction_nomenclature_n_idx"
  RENAME TO "ProductClassification_accountId_jurisdiction_nomenclature_norma";
