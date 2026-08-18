-- Reconcile columns present in Prisma schema but missing from historical migrations.
-- These IF NOT EXISTS clauses make this safe for environments where a column may
-- already have been added out-of-band.

ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "countryOfOrigin" TEXT;

ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "scenarioId" TEXT;

ALTER TABLE "HtsDutyRate"
  ADD COLUMN IF NOT EXISTS "exclusion" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RegulatoryUpdate"
  ADD COLUMN IF NOT EXISTS "documentNumber" TEXT;

ALTER TABLE "RegulatoryUpdate"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "RegulatoryUpdate_documentNumber_key"
  ON "RegulatoryUpdate"("documentNumber");

CREATE INDEX IF NOT EXISTS "Shipment_scenarioId_idx"
  ON "Shipment"("scenarioId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Shipment_scenarioId_fkey'
  ) THEN
    ALTER TABLE "Shipment"
      ADD CONSTRAINT "Shipment_scenarioId_fkey"
      FOREIGN KEY ("scenarioId") REFERENCES "LandedCostScenario"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
