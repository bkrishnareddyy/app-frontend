-- AlterTable
ALTER TABLE "FilingActionRule" DROP COLUMN "allowCancel";

-- CreateTable
CREATE TABLE "FilingChildActionRule" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "procedureCode" TEXT NOT NULL,
    "messageName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "FilingChildActionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilingChildActionRule_country_procedureCode_messageName_sta_key" ON "FilingChildActionRule"("country", "procedureCode", "messageName", "status", "action");
