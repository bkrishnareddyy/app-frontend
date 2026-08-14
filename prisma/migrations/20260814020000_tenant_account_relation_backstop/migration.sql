-- Phase 0 tenant-isolation fix: WorkMetricSnapshot, DrawbackLot, and
-- DrawbackClaimSequence carry accountId but previously had no `account`
-- relation, so the automatic Prisma isolation extension in src/lib/db.ts
-- (which scans the DMMF for a field literally named "account") never
-- applied its DataMode filter to these three models. Adding a real FK
-- relation makes them visible to that extension with no query-site changes.
--
-- NOTE: if any existing row's accountId does not reference a valid
-- Account.id, this migration will fail closed (the ADD CONSTRAINT will be
-- rejected) rather than silently succeeding with orphaned rows. That
-- failure must be investigated and resolved (fix or remove the orphaned
-- row) before re-running -- do not weaken the constraint to work around it.

ALTER TABLE "WorkMetricSnapshot"
  ADD CONSTRAINT "WorkMetricSnapshot_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DrawbackLot"
  ADD CONSTRAINT "DrawbackLot_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DrawbackClaimSequence"
  ADD CONSTRAINT "DrawbackClaimSequence_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
