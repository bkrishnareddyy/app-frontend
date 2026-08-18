-- AlterTable
ALTER TABLE "FilingProcedureConfig" ADD COLUMN "canCreateNewFiling" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "FilingProcedureConfig_canCreateNewFiling_idx" ON "FilingProcedureConfig"("canCreateNewFiling");

-- Update existing records: Set common amendment/cancellation messages to false
UPDATE "FilingProcedureConfig" SET "canCreateNewFiling" = false 
WHERE "messageName" IN ('IE013', 'IE014', 'IE517', 'IE518', 'IE519', 'IE520');

-- Comment explanation:
-- IE013: Amendment message (should not create new filing)
-- IE014: Cancellation message (should not create new filing)
-- IE517-IE520: Query/Response messages (should not create new filing)
