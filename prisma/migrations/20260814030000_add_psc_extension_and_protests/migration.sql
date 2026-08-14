-- Migration: add_psc_extension_and_protests
-- Adds PSC workflow fields, PscAttachment, Protest models, and updated DeadlineType enum values

-- ── Step 1: Extend PostSummaryCorrection ─────────────────────────────────

ALTER TABLE "PostSummaryCorrection"
  ADD COLUMN IF NOT EXISTS "dutyDelta"           DECIMAL,
  ADD COLUMN IF NOT EXISTS "interestEstimate"    DECIMAL,
  ADD COLUMN IF NOT EXISTS "legalBasis"          TEXT,
  ADD COLUMN IF NOT EXISTS "correctedHtsCode"    TEXT,
  ADD COLUMN IF NOT EXISTS "correctedValue"      DECIMAL,
  ADD COLUMN IF NOT EXISTS "correctedQuantity"   DECIMAL,
  ADD COLUMN IF NOT EXISTS "lineItemsAffected"   JSONB,
  ADD COLUMN IF NOT EXISTS "notes"               TEXT,
  ADD COLUMN IF NOT EXISTS "aceConfirmationNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "withdrawnAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "withdrawnByUserId"   TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedByUserId"    TEXT;

-- Update correctionType default to match new enum codes
-- Existing rows with old values are left as-is; the app handles both gracefully.
ALTER TABLE "PostSummaryCorrection"
  ALTER COLUMN "correctionType" SET DEFAULT 'CLASSIFICATION_CORRECTION';

CREATE INDEX IF NOT EXISTS "PostSummaryCorrection_status_idx"
  ON "PostSummaryCorrection"("status");

-- ── Step 2: PscAttachment ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PscAttachment" (
  "id"               TEXT        NOT NULL,
  "pscId"            TEXT        NOT NULL,
  "fileName"         TEXT        NOT NULL,
  "fileType"         TEXT        NOT NULL,
  "fileSize"         INTEGER     NOT NULL,
  "storageKey"       TEXT        NOT NULL,
  "label"            TEXT,
  "uploadedByUserId" TEXT        NOT NULL,
  "uploadedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PscAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PscAttachment_pscId_fkey"
    FOREIGN KEY ("pscId") REFERENCES "PostSummaryCorrection"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "PscAttachment_pscId_idx" ON "PscAttachment"("pscId");

-- ── Step 3: Protest ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Protest" (
  "id"                      TEXT         NOT NULL,
  "accountId"               TEXT         NOT NULL,
  "liquidationDate"         TIMESTAMP(3) NOT NULL,
  "protestDeadline"         TIMESTAMP(3) NOT NULL,
  "groundsCode"             TEXT         NOT NULL,
  "groundsNarrative"        TEXT         NOT NULL,
  "statuteCitation"         TEXT,
  "rulingReference"         TEXT,
  "claimAmount"             DECIMAL      NOT NULL,
  "interestClaimed"         BOOLEAN      NOT NULL DEFAULT false,
  "powerOfAttorneyVerified" BOOLEAN      NOT NULL DEFAULT false,
  "poaExpiresAt"            TIMESTAMP(3),
  "furtherReviewRequested"  BOOLEAN      NOT NULL DEFAULT false,
  "frpJustification"        TEXT,
  "protestNumber"           TEXT,
  "cbpDecisionDate"         TIMESTAMP(3),
  "cbpDecisionNarrative"    TEXT,
  "deemedDeniedAt"          TIMESTAMP(3),
  "citAppealDeadline"       TIMESTAMP(3),
  "citAppealFiledAt"        TIMESTAMP(3),
  "citCaseNumber"           TEXT,
  "linkedPscId"             TEXT,
  "status"                  TEXT         NOT NULL DEFAULT 'DRAFT',
  "filedAt"                 TIMESTAMP(3),
  "withdrawnAt"             TIMESTAMP(3),
  "withdrawnByUserId"       TEXT,
  "createdByUserId"         TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Protest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Protest_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE,
  CONSTRAINT "Protest_linkedPscId_fkey"
    FOREIGN KEY ("linkedPscId") REFERENCES "PostSummaryCorrection"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "Protest_accountId_idx"    ON "Protest"("accountId");
CREATE INDEX IF NOT EXISTS "Protest_status_idx"       ON "Protest"("status");
CREATE INDEX IF NOT EXISTS "Protest_protestDeadline_idx" ON "Protest"("protestDeadline");

-- ── Step 4: ProtestEntry ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ProtestEntry" (
  "id"              TEXT         NOT NULL,
  "protestId"       TEXT         NOT NULL,
  "filingId"        TEXT         NOT NULL,
  "entryNumber"     TEXT         NOT NULL,
  "liquidationDate" TIMESTAMP(3) NOT NULL,
  "dutyAssessed"    DECIMAL      NOT NULL,
  "dutyContested"   DECIMAL      NOT NULL,

  CONSTRAINT "ProtestEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProtestEntry_protestId_fkey"
    FOREIGN KEY ("protestId") REFERENCES "Protest"("id") ON DELETE CASCADE,
  CONSTRAINT "ProtestEntry_filingId_fkey"
    FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProtestEntry_protestId_idx" ON "ProtestEntry"("protestId");
CREATE INDEX IF NOT EXISTS "ProtestEntry_filingId_idx"  ON "ProtestEntry"("filingId");

-- ── Step 5: ProtestAttachment ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ProtestAttachment" (
  "id"               TEXT         NOT NULL,
  "protestId"        TEXT         NOT NULL,
  "fileName"         TEXT         NOT NULL,
  "fileType"         TEXT         NOT NULL,
  "fileSize"         INTEGER      NOT NULL,
  "storageKey"       TEXT         NOT NULL,
  "label"            TEXT,
  "uploadedByUserId" TEXT         NOT NULL,
  "uploadedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProtestAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProtestAttachment_protestId_fkey"
    FOREIGN KEY ("protestId") REFERENCES "Protest"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProtestAttachment_protestId_idx" ON "ProtestAttachment"("protestId");

-- ── Step 6: ProtestNote ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ProtestNote" (
  "id"         TEXT         NOT NULL,
  "protestId"  TEXT         NOT NULL,
  "authorId"   TEXT         NOT NULL,
  "body"       TEXT         NOT NULL,
  "isInternal" BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProtestNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProtestNote_protestId_fkey"
    FOREIGN KEY ("protestId") REFERENCES "Protest"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProtestNote_protestId_idx" ON "ProtestNote"("protestId");

-- ── Step 7: DeadlineType enum additions ───────────────────────────────────
-- PostgreSQL: add new enum values only if they don't already exist

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'PROTEST_WINDOW'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'DeadlineType')
  ) THEN
    ALTER TYPE "DeadlineType" ADD VALUE 'PROTEST_WINDOW';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'CIT_APPEAL_WINDOW'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'DeadlineType')
  ) THEN
    ALTER TYPE "DeadlineType" ADD VALUE 'CIT_APPEAL_WINDOW';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'DEEMED_DENIAL'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'DeadlineType')
  ) THEN
    ALTER TYPE "DeadlineType" ADD VALUE 'DEEMED_DENIAL';
  END IF;
END $$;
