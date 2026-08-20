-- AlterTable
ALTER TABLE "RestrictedPartyMatch" ADD COLUMN     "effectiveDate" TIMESTAMP(3),
ADD COLUMN     "expirationDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ScreeningEntity" ADD COLUMN     "agency" TEXT,
ADD COLUMN     "citation" TEXT,
ADD COLUMN     "effectiveDate" TIMESTAMP(3),
ADD COLUMN     "expirationDate" TIMESTAMP(3);
