-- The per-check embargo screening usage audit (EmbargoUsageHeader/Line) was
-- gated behind AccountEmbargoConfig.audited/generalAuditLogEnabled, both
-- defaulting to false with no seed, settings UI, or admin API anywhere in the
-- codebase to ever set them true -- so the audit trail could never fire for
-- any account. Default both on so screening invocations are audited out of
-- the box; existing rows are backfilled to match.
ALTER TABLE "AccountEmbargoConfig" ALTER COLUMN "audited" SET DEFAULT true;
ALTER TABLE "AccountEmbargoConfig" ALTER COLUMN "generalAuditLogEnabled" SET DEFAULT true;

UPDATE "AccountEmbargoConfig" SET "audited" = true WHERE "audited" = false;
UPDATE "AccountEmbargoConfig" SET "generalAuditLogEnabled" = true WHERE "generalAuditLogEnabled" = false;
