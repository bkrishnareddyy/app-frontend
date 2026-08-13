-- F02 · Document Intelligence Pipeline
--
-- B-1: DocumentType enum + structured classification columns on ShipmentDocument
-- C-1: ExtractionField provenance columns (correctedFromValue, correctedByUserId, correctedAt)
--
-- ShipmentDocument.docType (String) is unchanged — 169+ callers are unaffected.
-- documentType and documentTypeConfidence are additive columns set by the
-- classification pipeline going forward.

-- ---------------------------------------------------------------------------
-- B-1: DocumentType Postgres enum
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "DocumentType" AS ENUM (
    'COMMERCIAL_INVOICE',
    'PACKING_LIST',
    'BILL_OF_LADING',
    'AIR_WAYBILL',
    'CERTIFICATE_OF_ORIGIN',
    'PHYTOSANITARY_CERTIFICATE',
    'FUMIGATION_CERTIFICATE',
    'CUSTOMS_BOND',
    'POWER_OF_ATTORNEY',
    'ENTRY_SUMMARY',
    'ISF',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Structured classification result from the AI pipeline.
-- Null until the classifier runs for the first time.
ALTER TABLE "ShipmentDocument"
  ADD COLUMN IF NOT EXISTS "documentType"           "DocumentType",
  ADD COLUMN IF NOT EXISTS "documentTypeConfidence" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "ShipmentDocument_documentType_idx"
  ON "ShipmentDocument" ("documentType");

-- ---------------------------------------------------------------------------
-- C-1: ExtractionField provenance for human corrections
-- ---------------------------------------------------------------------------

ALTER TABLE "ExtractionField"
  ADD COLUMN IF NOT EXISTS "correctedFromValue" TEXT,
  ADD COLUMN IF NOT EXISTS "correctedByUserId"  TEXT,
  ADD COLUMN IF NOT EXISTS "correctedAt"        TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ExtractionField_documentId_source_idx"
  ON "ExtractionField" ("documentId", "source");
