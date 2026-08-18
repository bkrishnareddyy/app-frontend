-- Reconcile columns present in Prisma schema but missing from historical migrations.
-- These IF NOT EXISTS clauses make this safe for environments where a column may
-- already have been added out-of-band.

ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "countryOfOrigin" TEXT;

ALTER TABLE "HtsDutyRate"
  ADD COLUMN IF NOT EXISTS "exclusion" TEXT;

ALTER TABLE "RegulatoryUpdate"
  ADD COLUMN IF NOT EXISTS "documentNumber" TEXT;
