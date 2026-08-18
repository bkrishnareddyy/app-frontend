-- Compatibility bridge for the fresh-database migration chain.
--
-- `20260807161055_declare_out_of_band_tables` declares foreign keys for
-- columns that existed in long-lived developer databases but were not created
-- by the enterprise baseline migration. A clean CI/shadow database therefore
-- fails before it can reach any later migrations.
--
-- This migration is intentionally ordered immediately after the baseline and
-- before the out-of-band FK declarations. Every statement is idempotent so it
-- is safe for environments where the columns already exist.

ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT;

ALTER TABLE "ImporterOfRecord"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT;

ALTER TABLE "LandedCostScenarioLineItem"
  ADD COLUMN IF NOT EXISTS "htsCodeId" TEXT;
