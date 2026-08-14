-- CreateTable
CREATE TABLE "FilingActionDataRequirement" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "procedureCode" TEXT NOT NULL,
    "messageName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fields" JSONB NOT NULL,

    CONSTRAINT "FilingActionDataRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilingActionDataRequirement_country_procedureCode_messageNa_key" ON "FilingActionDataRequirement"("country", "procedureCode", "messageName", "action");

-- CreateIndex
CREATE UNIQUE INDEX "HtsChange_fromReleaseId_toReleaseId_changeType_oldHtsNodeId_key" ON "HtsChange"("fromReleaseId", "toReleaseId", "changeType", "oldHtsNodeId", "newHtsNodeId");
