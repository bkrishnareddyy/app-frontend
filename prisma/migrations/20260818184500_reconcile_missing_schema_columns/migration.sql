-- Reconcile columns present in Prisma schema but missing from historical migrations.
-- This migration has not been released yet. IF NOT EXISTS guards also make it safe
-- for long-lived environments where individual columns may have been added out-of-band.

ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "countryOfOrigin" TEXT;

ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "scenarioId" TEXT;

-- Master/house shipment hierarchy. A house shipment optionally points to another
-- Shipment row as its master. Prisma models this as a nullable self-relation.
ALTER TABLE "Shipment"
  ADD COLUMN IF NOT EXISTS "masterShipmentId" TEXT;

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

CREATE INDEX IF NOT EXISTS "Shipment_masterShipmentId_idx"
  ON "Shipment"("masterShipmentId");

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Shipment_masterShipmentId_fkey'
  ) THEN
    ALTER TABLE "Shipment"
      ADD CONSTRAINT "Shipment_masterShipmentId_fkey"
      FOREIGN KEY ("masterShipmentId") REFERENCES "Shipment"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
