-- Repairs 20260808060000_production_data_honesty, which is recorded as applied
-- but whose enum, Account.dataMode, ShipmentSequence and healthStatus changes
-- never reached the database. Every statement is written to be safe to re-run,
-- because some environments did receive part of that migration.

-- CreateEnum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DataMode') THEN
        CREATE TYPE "DataMode" AS ENUM ('PRODUCTION', 'DEMO', 'SANDBOX');
    END IF;
END
$$;

-- AlterTable
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "dataMode" "DataMode" NOT NULL DEFAULT 'PRODUCTION';

-- AlterTable: a health status that has not been evaluated is unknown, not 'Healthy'.
ALTER TABLE "Shipment" ALTER COLUMN "healthStatus" DROP NOT NULL,
                       ALTER COLUMN "healthStatus" DROP DEFAULT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShipmentSequence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentSequence_accountId_year_key" ON "ShipmentSequence"("accountId", "year");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentSequence_accountId_fkey'
    ) THEN
        ALTER TABLE "ShipmentSequence"
            ADD CONSTRAINT "ShipmentSequence_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

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
GROUP BY "accountId", CAST(split_part("shipmentNumber", '-', 2) AS INTEGER)
ON CONFLICT ("accountId", "year") DO NOTHING;
