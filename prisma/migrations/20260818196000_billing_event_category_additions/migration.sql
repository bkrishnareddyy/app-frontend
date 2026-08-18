-- Add 4 new BillingEventCategory values introduced in billing phase 2.
-- BillingEventCategory was created with 14 original values by
-- 20260818195000_align_prisma_schema_core. IF NOT EXISTS makes this safe
-- to replay regardless of which path the DB took to reach this point.
ALTER TYPE "BillingEventCategory" ADD VALUE IF NOT EXISTS 'ORIGIN_DETERMINATION';
ALTER TYPE "BillingEventCategory" ADD VALUE IF NOT EXISTS 'VALUATION';
ALTER TYPE "BillingEventCategory" ADD VALUE IF NOT EXISTS 'COMPLIANCE_REVIEW';
ALTER TYPE "BillingEventCategory" ADD VALUE IF NOT EXISTS 'FILING_READINESS';
