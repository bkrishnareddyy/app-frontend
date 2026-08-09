-- Production data honesty:
--   * introduces the workspace data mode (PRODUCTION / DEMO / SANDBOX)
--   * removes fabricated column defaults so unknown values are genuinely NULL
--   * adds a concurrency-safe shipment number allocator
--
-- NOTE: existing rows keep their current values. Rows created before this
-- migration may still hold the previous fabricated defaults (readinessScore 87,
-- riskScore 28, ownerName 'Stephen', CustomsFiling totals 17750/2850/13100/16250,
-- filingStatus 'Filed', paymentStatus 'Paid'). Those require a deliberate
-- backfill/review; this migration does not guess which of them were real.

-- CreateEnum
CREATE TYPE "DataMode" AS ENUM ('PRODUCTION', 'DEMO', 'SANDBOX');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "dataMode" "DataMode" NOT NULL DEFAULT 'PRODUCTION';

-- AlterTable: Shipment — drop fabricated defaults, allow unknown values
ALTER TABLE "Shipment" ALTER COLUMN "entryType" DROP NOT NULL,
                       ALTER COLUMN "entryType" DROP DEFAULT,
                       ALTER COLUMN "incoterm" DROP NOT NULL,
                       ALTER COLUMN "incoterm" DROP DEFAULT,
                       ALTER COLUMN "portOfEntry" DROP DEFAULT,
                       ALTER COLUMN "carrierName" DROP DEFAULT,
                       ALTER COLUMN "countryOfExport" DROP DEFAULT,
                       ALTER COLUMN "status" SET DEFAULT 'Draft',
                       ALTER COLUMN "healthStatus" DROP NOT NULL,
                       ALTER COLUMN "healthStatus" DROP DEFAULT,
                       ALTER COLUMN "readinessScore" DROP NOT NULL,
                       ALTER COLUMN "readinessScore" DROP DEFAULT,
                       ALTER COLUMN "riskScore" DROP NOT NULL,
                       ALTER COLUMN "riskScore" DROP DEFAULT,
                       ALTER COLUMN "ownerName" DROP NOT NULL,
                       ALTER COLUMN "ownerName" DROP DEFAULT;

-- AlterTable: ShipmentDocument
ALTER TABLE "ShipmentDocument" ALTER COLUMN "pageCount" DROP NOT NULL,
                               ALTER COLUMN "pageCount" DROP DEFAULT,
                               ALTER COLUMN "confidence" DROP NOT NULL,
                               ALTER COLUMN "confidence" DROP DEFAULT;

-- AlterTable: ShipmentLineItem
ALTER TABLE "ShipmentLineItem" ALTER COLUMN "htsConfidence" DROP NOT NULL,
                               ALTER COLUMN "htsConfidence" DROP DEFAULT,
                               ALTER COLUMN "eccnCode" DROP DEFAULT,
                               ALTER COLUMN "status" SET DEFAULT 'Unreviewed';

-- AlterTable: AgentDecision
ALTER TABLE "AgentDecision" ALTER COLUMN "confidence" DROP NOT NULL,
                            ALTER COLUMN "confidence" DROP DEFAULT,
                            ALTER COLUMN "modelVersion" DROP DEFAULT;

-- AlterTable: CustomsFiling — money and filing state must never be assumed
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

-- AlterTable: CustomsResponse
ALTER TABLE "CustomsResponse" ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable: RegulatoryUpdate
ALTER TABLE "RegulatoryUpdate" ALTER COLUMN "affectedShipmentsCount" DROP NOT NULL,
                               ALTER COLUMN "affectedShipmentsCount" DROP DEFAULT,
                               ALTER COLUMN "publishedText" DROP NOT NULL,
                               ALTER COLUMN "publishedText" DROP DEFAULT;

-- AlterTable: ExtractionField
ALTER TABLE "ExtractionField" ALTER COLUMN "confidence" DROP NOT NULL,
                              ALTER COLUMN "confidence" DROP DEFAULT,
                              ALTER COLUMN "pageNumber" DROP NOT NULL,
                              ALTER COLUMN "pageNumber" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ShipmentSequence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentSequence_accountId_year_key" ON "ShipmentSequence"("accountId", "year");

-- AddForeignKey
ALTER TABLE "ShipmentSequence" ADD CONSTRAINT "ShipmentSequence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the allocator from existing shipment numbers so numbering continues
-- rather than colliding with already-issued numbers.
INSERT INTO "ShipmentSequence" ("id", "accountId", "year", "lastValue", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "accountId",
    CAST(split_part("shipmentNumber", '-', 2) AS INTEGER),
    MAX(CAST(split_part("shipmentNumber", '-', 3) AS INTEGER)),
    CURRENT_TIMESTAMP
FROM "Shipment"
WHERE "shipmentNumber" ~ '^SHP-[0-9]{4}-[0-9]+$'
GROUP BY "accountId", CAST(split_part("shipmentNumber", '-', 2) AS INTEGER);
