-- Upstream's HTS hardening moves classification and duty lookups onto the
-- ingested HtsNode/HtsDutyRate data, so the legacy HTSCode table goes away and
-- LandedCostScenarioLineItem points at HtsNode again.
--
-- This reverses 20260810130000, which created HTSCode and repointed the key at
-- it. That was the wrong direction: HTSCode was empty while HtsNode holds the
-- real ingested schedule. Both tables were verified empty of scenario
-- references before the key was moved.

ALTER TABLE "LandedCostScenarioLineItem" DROP CONSTRAINT IF EXISTS "LandedCostScenarioLineItem_htsCodeId_fkey";

DROP TABLE IF EXISTS "HTSCode";

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'LandedCostScenarioLineItem_htsCodeId_fkey'
    ) THEN
        ALTER TABLE "LandedCostScenarioLineItem"
            ADD CONSTRAINT "LandedCostScenarioLineItem_htsCodeId_fkey"
            FOREIGN KEY ("htsCodeId") REFERENCES "HtsNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
