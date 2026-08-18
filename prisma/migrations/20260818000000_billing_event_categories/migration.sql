-- Create BillingEventCategory with all 18 values if it doesn't exist yet.
-- EXCEPTION WHEN duplicate_object is the PostgreSQL-idiomatic no-op guard;
-- unlike the DO/IF NOT EXISTS pattern, this never pre-parses ALTER TYPE
-- against a potentially-absent type name.
DO $$ BEGIN
  CREATE TYPE "BillingEventCategory" AS ENUM (
    'DOCUMENT_PROCESSING',
    'CLASSIFICATION',
    'HUMAN_REVIEW',
    'PRODUCT_NORMALIZATION',
    'RECONCILIATION',
    'PGA_PROCESSING',
    'EXCEPTION_RESOLUTION',
    'CUSTOMS_ENTRY',
    'ACE_FILING',
    'ISF_FILING',
    'DUTY_DRAWBACK',
    'POST_SUMMARY_CORRECTION',
    'MANUAL_INTERVENTION',
    'CUSTOM',
    'ORIGIN_DETERMINATION',
    'VALUATION',
    'COMPLIANCE_REVIEW',
    'FILING_READINESS'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- On a fresh DB the DO block above just created the type with all 18 values,
-- so these are no-ops. On an existing DB (type already had 14 values from a
-- prior db push), these add the 4 new values. IF NOT EXISTS makes both safe.
ALTER TYPE "BillingEventCategory" ADD VALUE IF NOT EXISTS 'ORIGIN_DETERMINATION';
ALTER TYPE "BillingEventCategory" ADD VALUE IF NOT EXISTS 'VALUATION';
ALTER TYPE "BillingEventCategory" ADD VALUE IF NOT EXISTS 'COMPLIANCE_REVIEW';
ALTER TYPE "BillingEventCategory" ADD VALUE IF NOT EXISTS 'FILING_READINESS';
