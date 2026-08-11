-- Adds the columns the merged PipelineOrchestrator needs:
-- AgentDecision.lineNumber lets an approve/reject action target a specific
-- ShipmentLineItem directly instead of matching on the current htsCode
-- string (which breaks for a first-ever classification, see decisions/route.ts).
-- AgentExecutionRecord gains the accountId/stepNumber/decisionId/confidence/
-- aiProviderUsed/inputSnapshot/outputSnapshot columns AgentExecutionLog
-- already had, so the merged orchestrator can write to one execution-log
-- table instead of two, and so each step's snapshot answers "what did this
-- agent actually see" directly from the row.
--
-- Guarded (IF NOT EXISTS) per this project's established migration pattern,
-- since `prisma migrate dev`'s shadow-database replay cannot rebuild this
-- schema from scratch (see 20260810140000_declare_out_of_band_schema) --
-- this migration is applied directly via `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "AgentDecision" ADD COLUMN IF NOT EXISTS "lineNumber" INTEGER;

-- AlterTable
ALTER TABLE "AgentExecutionRecord" ADD COLUMN IF NOT EXISTS "accountId" TEXT,
                                    ADD COLUMN IF NOT EXISTS "stepNumber" INTEGER,
                                    ADD COLUMN IF NOT EXISTS "confidence" JSONB,
                                    ADD COLUMN IF NOT EXISTS "decisionId" TEXT,
                                    ADD COLUMN IF NOT EXISTS "aiProviderUsed" TEXT,
                                    ADD COLUMN IF NOT EXISTS "inputSnapshot" JSONB,
                                    ADD COLUMN IF NOT EXISTS "outputSnapshot" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentExecutionRecord_accountId_idx" ON "AgentExecutionRecord"("accountId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentExecutionRecord_accountId_fkey') THEN
        ALTER TABLE "AgentExecutionRecord" ADD CONSTRAINT "AgentExecutionRecord_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
