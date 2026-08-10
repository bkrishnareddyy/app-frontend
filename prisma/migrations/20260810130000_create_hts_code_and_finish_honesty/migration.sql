-- Second repair for 20260808060000_production_data_honesty, plus the HTSCode
-- table that the tariff engine, the classification agent and /api/hts all query
-- but that was never created here.
--
-- DROP NOT NULL / DROP DEFAULT / SET DEFAULT are all safe to re-run.
--
-- Deliberately excluded from this migration, even though `migrate diff` reports
-- them: dropping AgentExecutionLog.durationMs/invokedBy/runId/triggerEvent,
-- AgentExecutionRecord.runId and HtsRelease.country. Those columns hold data and
-- the schema is behind the database there, not ahead of it.

-- AlterTable
ALTER TABLE "AgentDecision" ALTER COLUMN "confidence" DROP NOT NULL,
                            ALTER COLUMN "confidence" DROP DEFAULT,
                            ALTER COLUMN "modelVersion" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomsFiling" ALTER COLUMN "filingStatus" SET DEFAULT 'Draft',
                            ALTER COLUMN "paymentStatus" SET DEFAULT 'Pending',
                            ALTER COLUMN "totalValue" DROP NOT NULL,
                            ALTER COLUMN "totalValue" DROP DEFAULT,
                            ALTER COLUMN "totalDuties" DROP NOT NULL,
                            ALTER COLUMN "totalDuties" DROP DEFAULT,
                            ALTER COLUMN "totalTaxes" DROP NOT NULL,
                            ALTER COLUMN "totalTaxes" DROP DEFAULT,
                            ALTER COLUMN "totalAmount" DROP NOT NULL,
                            ALTER COLUMN "totalAmount" DROP DEFAULT,
                            ALTER COLUMN "submittedAt" DROP NOT NULL,
                            ALTER COLUMN "submittedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomsResponse" ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExtractionField" ALTER COLUMN "confidence" DROP NOT NULL,
                              ALTER COLUMN "confidence" DROP DEFAULT,
                              ALTER COLUMN "pageNumber" DROP NOT NULL,
                              ALTER COLUMN "pageNumber" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RegulatoryUpdate" ALTER COLUMN "affectedShipmentsCount" DROP NOT NULL,
                               ALTER COLUMN "affectedShipmentsCount" DROP DEFAULT,
                               ALTER COLUMN "publishedText" DROP NOT NULL,
                               ALTER COLUMN "publishedText" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Shipment" ALTER COLUMN "status" SET DEFAULT 'Draft';

-- AlterTable
ALTER TABLE "ShipmentDocument" ALTER COLUMN "pageCount" DROP NOT NULL,
                               ALTER COLUMN "pageCount" DROP DEFAULT,
                               ALTER COLUMN "confidence" DROP NOT NULL,
                               ALTER COLUMN "confidence" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ShipmentLineItem" ALTER COLUMN "htsConfidence" DROP NOT NULL,
                               ALTER COLUMN "htsConfidence" DROP DEFAULT,
                               ALTER COLUMN "eccnCode" DROP DEFAULT,
                               ALTER COLUMN "status" SET DEFAULT 'Unreviewed';

-- CreateTable
CREATE TABLE IF NOT EXISTS "HTSCode" (
    "id" TEXT NOT NULL,
    "htsCode10" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chapterNumber" TEXT NOT NULL,
    "headingNumber" TEXT NOT NULL,
    "subheadingNumber" TEXT NOT NULL,
    "unitOfQuantity" TEXT DEFAULT 'PCS',
    "generalDutyRate" TEXT NOT NULL DEFAULT 'Free',
    "specialRatePrograms" JSONB,
    "column2DutyRate" TEXT DEFAULT '35%',
    "section301Applicable" BOOLEAN NOT NULL DEFAULT false,
    "section301AdditionalRate" DECIMAL(65,30) DEFAULT 0.0,
    "section232Applicable" BOOLEAN NOT NULL DEFAULT false,
    "section232AdditionalRate" DECIMAL(65,30) DEFAULT 0.0,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expirationDate" TIMESTAMP(3),
    "sourceRevision" TEXT NOT NULL DEFAULT 'HTSUS 2026 Rev 1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HTSCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "HTSCode_htsCode10_key" ON "HTSCode"("htsCode10");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HTSCode_htsCode10_idx" ON "HTSCode"("htsCode10");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HTSCode_chapterNumber_idx" ON "HTSCode"("chapterNumber");

-- The scenario line item's htsCodeId is written from a HTSCode lookup, so the
-- constraint is repointed off HtsNode. Verified empty before repointing.
ALTER TABLE "LandedCostScenarioLineItem" DROP CONSTRAINT IF EXISTS "LandedCostScenarioLineItem_htsCodeId_fkey";

ALTER TABLE "LandedCostScenarioLineItem"
    ADD CONSTRAINT "LandedCostScenarioLineItem_htsCodeId_fkey"
    FOREIGN KEY ("htsCodeId") REFERENCES "HTSCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
