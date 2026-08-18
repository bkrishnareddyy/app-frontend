-- Phase 0 tenant-isolation fix: WorkMetricSnapshot, DrawbackLot, and
-- DrawbackClaimSequence carry accountId but previously had no `account`
-- relation, so the automatic Prisma isolation extension in src/lib/db.ts
-- (which scans the DMMF for a field literally named "account") never
-- applied its DataMode filter to these three models. Adding a real FK
-- relation makes them visible to that extension with no query-site changes.
--
-- Long-lived environments already had these tables out-of-band, while the
-- historical fresh-database migration chain did not declare all of them.
-- Guard table existence so this tenant backstop can still be deployed to a
-- clean CI/shadow database. When a table exists, the FK is still fail-closed:
-- orphaned accountId values will reject the constraint rather than being
-- silently accepted.

DO $$
BEGIN
  IF to_regclass('"WorkMetricSnapshot"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkMetricSnapshot_accountId_fkey') THEN
    ALTER TABLE "WorkMetricSnapshot"
      ADD CONSTRAINT "WorkMetricSnapshot_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"DrawbackLot"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DrawbackLot_accountId_fkey') THEN
    ALTER TABLE "DrawbackLot"
      ADD CONSTRAINT "DrawbackLot_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"DrawbackClaimSequence"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DrawbackClaimSequence_accountId_fkey') THEN
    ALTER TABLE "DrawbackClaimSequence"
      ADD CONSTRAINT "DrawbackClaimSequence_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
