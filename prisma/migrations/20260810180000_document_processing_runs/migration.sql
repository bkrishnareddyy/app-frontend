-- Document Intelligence: turn DocumentParseVersion into the durable processing
-- run for the parsing pipeline, and record the immutable original's size and
-- media type alongside the SHA-256 already stored in ShipmentDocument.checksum.
--
-- Additive and non-destructive throughout: every new column is nullable or
-- defaulted, so existing Gemini-vision parse rows and existing documents remain
-- valid without a data rewrite. Nothing is dropped or retyped. Guarded with
-- IF NOT EXISTS so it is safe to re-apply against a database that already has
-- part of it.

-- AlterTable: the immutable original's own metadata.
ALTER TABLE "ShipmentDocument" ADD COLUMN IF NOT EXISTS "byteSize" INTEGER,
                               ADD COLUMN IF NOT EXISTS "mimeType" TEXT,
                               ADD COLUMN IF NOT EXISTS "activeParseVersionId" TEXT;

-- AlterTable: processing-run state.
ALTER TABLE "DocumentParseVersion"
    ADD COLUMN IF NOT EXISTS "accountId" TEXT,
    ADD COLUMN IF NOT EXISTS "parserProvider" TEXT,
    ADD COLUMN IF NOT EXISTS "parserName" TEXT,
    ADD COLUMN IF NOT EXISTS "profile" TEXT,
    ADD COLUMN IF NOT EXISTS "reason" TEXT,
    ADD COLUMN IF NOT EXISTS "configHash" TEXT,
    ADD COLUMN IF NOT EXISTS "schemaVersion" TEXT,
    ADD COLUMN IF NOT EXISTS "externalTaskId" TEXT,
    ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
    ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'SUCCEEDED',
    ADD COLUMN IF NOT EXISTS "providerStatus" TEXT,
    ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "lastPolledAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "nextPollAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "pollAttemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS "durationMs" INTEGER,
    ADD COLUMN IF NOT EXISTS "pageCount" INTEGER,
    ADD COLUMN IF NOT EXISTS "ocrUsed" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "fullPageOcrUsed" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "errorCode" TEXT,
    ADD COLUMN IF NOT EXISTS "errorMessage" TEXT,
    ADD COLUMN IF NOT EXISTS "retryable" BOOLEAN,
    ADD COLUMN IF NOT EXISTS "warningsJson" JSONB,
    ADD COLUMN IF NOT EXISTS "qualityJson" JSONB,
    ADD COLUMN IF NOT EXISTS "artifactsJson" JSONB,
    ADD COLUMN IF NOT EXISTS "correlationId" TEXT;

-- Backfill tenant ownership from the parent document so existing runs are
-- reachable through the same tenant-scoped queries as new ones. Read-only with
-- respect to every other column.
UPDATE "DocumentParseVersion" pv
   SET "accountId" = d."accountId"
  FROM "ShipmentDocument" d
 WHERE pv."documentId" = d."id"
   AND pv."accountId" IS NULL;

-- Existing rows came from the Gemini vision agent, not from a parser provider.
-- Naming that explicitly keeps provider attribution honest for historical runs.
UPDATE "DocumentParseVersion"
   SET "parserProvider" = 'GEMINI_VISION'
 WHERE "parserProvider" IS NULL;

-- Existing rows are completed parses; the column default already says SUCCEEDED,
-- this covers any row written before the default existed.
UPDATE "DocumentParseVersion"
   SET "status" = 'SUCCEEDED'
 WHERE "status" IS NULL;

-- ShipmentDocument.byteSize and .mimeType are deliberately NOT backfilled: for a
-- document uploaded before those columns existed, the values were never recorded
-- anywhere, and 0 is not the same fact as "unknown". They stay NULL until the
-- document is re-uploaded.

-- Idempotency: one run per (tenant, content hash, provider, profile, config).
-- Enforced in the database so a duplicate queue delivery or a double-clicked
-- reprocess cannot create a second run for identical work.
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentParseVersion_idempotencyKey_key"
    ON "DocumentParseVersion" ("idempotencyKey");

-- Query-path indexes for the worker's "what is due" scans and tenant reads.
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_accountId_idx"
    ON "DocumentParseVersion" ("accountId");
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_status_nextPollAt_idx"
    ON "DocumentParseVersion" ("status", "nextPollAt");
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_status_nextRetryAt_idx"
    ON "DocumentParseVersion" ("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_status_heartbeatAt_idx"
    ON "DocumentParseVersion" ("status", "heartbeatAt");

-- Duplicate-upload detection reads documents by tenant + content hash.
CREATE INDEX IF NOT EXISTS "ShipmentDocument_accountId_checksum_idx"
    ON "ShipmentDocument" ("accountId", "checksum");

-- Tenant cascade for processing runs.
DO $$
BEGIN
    ALTER TABLE "DocumentParseVersion"
        ADD CONSTRAINT "DocumentParseVersion_accountId_fkey"
        FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
