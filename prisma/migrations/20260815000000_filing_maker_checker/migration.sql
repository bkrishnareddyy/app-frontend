-- AlterTable
ALTER TABLE "CustomsFiling" ADD COLUMN     "preparedByUserId" TEXT,
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "transmittedByUserId" TEXT;
