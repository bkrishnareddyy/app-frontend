-- DropForeignKey
ALTER TABLE "CustomsFiling" DROP CONSTRAINT IF EXISTS "CustomsFiling_transactionTypeId_fkey";

-- DropForeignKey
ALTER TABLE "FilingProcedureConfig" DROP CONSTRAINT IF EXISTS "FilingProcedureConfig_transactionTypeId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "CustomsFiling_transactionTypeId_idx";

-- DropIndex
DROP INDEX IF EXISTS "FilingProcedureConfig_transactionTypeId_idx";

-- DropIndex
DROP INDEX IF EXISTS "FilingUIConfig_country_procedureCode_messageName_messageTyp_idx";

-- AlterTable
ALTER TABLE "CustomsFiling" DROP COLUMN IF EXISTS "transactionTypeId";

-- AlterTable
ALTER TABLE "FilingProcedureConfig" DROP COLUMN IF EXISTS "transactionTypeId";

-- AlterTable
ALTER TABLE "FilingUIConfig" DROP COLUMN IF EXISTS "transactionType";

-- CreateIndex
CREATE INDEX "FilingUIConfig_country_procedureCode_messageName_messageTyp_idx" ON "FilingUIConfig"("country", "procedureCode", "messageName", "messageType");

-- DropIndex (old unique constraint with transactionType)
ALTER TABLE "FilingUIConfig" DROP CONSTRAINT IF EXISTS "FilingUIConfig_country_procedureCode_messageName_messageTyp_key";

-- CreateIndex (new unique constraint without transactionType)
ALTER TABLE "FilingUIConfig" ADD CONSTRAINT "FilingUIConfig_country_procedureCode_messageName_messageTyp_key" UNIQUE ("country", "procedureCode", "messageName", "messageType");
