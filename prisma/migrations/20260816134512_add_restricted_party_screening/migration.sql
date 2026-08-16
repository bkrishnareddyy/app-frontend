-- CreateEnum
CREATE TYPE "RestrictedPartyScreeningSource" AS ENUM ('PARTY_MASTER', 'SHIPMENT', 'LINE', 'PUBLIC_API', 'COPILOT', 'MANUAL');

-- CreateEnum
CREATE TYPE "RestrictedPartyScreeningStatus" AS ENUM ('CLEAR', 'HIT', 'REVIEW_REQUIRED', 'PARTIAL', 'SKIPPED', 'ERROR', 'STALE');

-- CreateEnum
CREATE TYPE "RestrictedPartyPassType" AS ENUM ('PARTY_NAME', 'CONTACT_NAME');

-- CreateEnum
CREATE TYPE "RestrictedPartyMatchMethod" AS ENUM ('EXACT', 'RAW_WORD', 'METAPHONE', 'DOUBLE_METAPHONE', 'COMBINED');

-- CreateEnum
CREATE TYPE "RestrictedPartyDispositionStatus" AS ENUM ('PENDING', 'CONFIRMED_MATCH', 'FALSE_POSITIVE', 'APPROVED', 'BLOCKED', 'REQUEST_MORE_INFORMATION');

-- CreateTable
CREATE TABLE "RestrictedPartyScreeningResult" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "source" "RestrictedPartyScreeningSource" NOT NULL,
    "shipmentId" TEXT,
    "lineItemId" TEXT,
    "partyId" TEXT,
    "externalReference" TEXT,
    "passType" "RestrictedPartyPassType" NOT NULL,
    "screenedName" TEXT NOT NULL,
    "screenedAddress" TEXT,
    "screenedCity" TEXT,
    "screenedCountry" TEXT,
    "nameThreshold" INTEGER NOT NULL,
    "addressThreshold" INTEGER,
    "countryMatchRequired" BOOLEAN NOT NULL,
    "redFlagCheckEnabled" BOOLEAN NOT NULL,
    "status" "RestrictedPartyScreeningStatus" NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "redFlagCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "screeningInputHash" TEXT NOT NULL,
    "screeningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screeningDurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestrictedPartyScreeningResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestrictedPartyMatch" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "screeningEntityId" TEXT NOT NULL,
    "matchedName" TEXT NOT NULL,
    "matchedAddress" TEXT,
    "nameScore" INTEGER NOT NULL,
    "addressScore" INTEGER,
    "matchMethod" "RestrictedPartyMatchMethod" NOT NULL,
    "countryMatch" BOOLEAN,
    "sourceList" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "programCodes" TEXT[],
    "denialType" TEXT,
    "agency" TEXT,
    "citation" TEXT,
    "suppressedByApprovedParty" BOOLEAN NOT NULL DEFAULT false,
    "suppressingDispositionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestrictedPartyMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestrictedPartyRedFlagHit" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "keywordRuleId" TEXT,
    "matchedWord" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestrictedPartyRedFlagHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestrictedPartyDisposition" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "RestrictedPartyDispositionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestrictedPartyDisposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyScreeningSummary" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "screeningStatus" "RestrictedPartyScreeningStatus" NOT NULL,
    "lastScreenedAt" TIMESTAMP(3),
    "lastScreeningResultId" TEXT,
    "currentInputHash" TEXT,
    "screeningValidUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyScreeningSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestrictedPartyScreeningResult_accountId_screeningDate_idx" ON "RestrictedPartyScreeningResult"("accountId", "screeningDate");

-- CreateIndex
CREATE INDEX "RestrictedPartyScreeningResult_accountId_partyId_idx" ON "RestrictedPartyScreeningResult"("accountId", "partyId");

-- CreateIndex
CREATE INDEX "RestrictedPartyScreeningResult_accountId_shipmentId_idx" ON "RestrictedPartyScreeningResult"("accountId", "shipmentId");

-- CreateIndex
CREATE INDEX "RestrictedPartyScreeningResult_accountId_lineItemId_idx" ON "RestrictedPartyScreeningResult"("accountId", "lineItemId");

-- CreateIndex
CREATE INDEX "RestrictedPartyScreeningResult_accountId_status_idx" ON "RestrictedPartyScreeningResult"("accountId", "status");

-- CreateIndex
CREATE INDEX "RestrictedPartyScreeningResult_correlationId_idx" ON "RestrictedPartyScreeningResult"("correlationId");

-- CreateIndex
CREATE INDEX "RestrictedPartyScreeningResult_screeningInputHash_idx" ON "RestrictedPartyScreeningResult"("screeningInputHash");

-- CreateIndex
CREATE INDEX "RestrictedPartyMatch_resultId_idx" ON "RestrictedPartyMatch"("resultId");

-- CreateIndex
CREATE INDEX "RestrictedPartyMatch_screeningEntityId_idx" ON "RestrictedPartyMatch"("screeningEntityId");

-- CreateIndex
CREATE INDEX "RestrictedPartyRedFlagHit_resultId_idx" ON "RestrictedPartyRedFlagHit"("resultId");

-- CreateIndex
CREATE UNIQUE INDEX "RestrictedPartyDisposition_resultId_key" ON "RestrictedPartyDisposition"("resultId");

-- CreateIndex
CREATE INDEX "RestrictedPartyDisposition_accountId_status_idx" ON "RestrictedPartyDisposition"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartyScreeningSummary_partyId_key" ON "PartyScreeningSummary"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyScreeningSummary_lastScreeningResultId_key" ON "PartyScreeningSummary"("lastScreeningResultId");

-- CreateIndex
CREATE INDEX "PartyScreeningSummary_accountId_screeningStatus_idx" ON "PartyScreeningSummary"("accountId", "screeningStatus");

-- AddForeignKey
ALTER TABLE "RestrictedPartyScreeningResult" ADD CONSTRAINT "RestrictedPartyScreeningResult_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedPartyScreeningResult" ADD CONSTRAINT "RestrictedPartyScreeningResult_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedPartyScreeningResult" ADD CONSTRAINT "RestrictedPartyScreeningResult_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "ShipmentLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedPartyScreeningResult" ADD CONSTRAINT "RestrictedPartyScreeningResult_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedPartyMatch" ADD CONSTRAINT "RestrictedPartyMatch_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "RestrictedPartyScreeningResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedPartyMatch" ADD CONSTRAINT "RestrictedPartyMatch_screeningEntityId_fkey" FOREIGN KEY ("screeningEntityId") REFERENCES "ScreeningEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedPartyRedFlagHit" ADD CONSTRAINT "RestrictedPartyRedFlagHit_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "RestrictedPartyScreeningResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedPartyRedFlagHit" ADD CONSTRAINT "RestrictedPartyRedFlagHit_keywordRuleId_fkey" FOREIGN KEY ("keywordRuleId") REFERENCES "ComplianceKeywordRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedPartyDisposition" ADD CONSTRAINT "RestrictedPartyDisposition_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "RestrictedPartyScreeningResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedPartyDisposition" ADD CONSTRAINT "RestrictedPartyDisposition_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyScreeningSummary" ADD CONSTRAINT "PartyScreeningSummary_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyScreeningSummary" ADD CONSTRAINT "PartyScreeningSummary_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyScreeningSummary" ADD CONSTRAINT "PartyScreeningSummary_lastScreeningResultId_fkey" FOREIGN KEY ("lastScreeningResultId") REFERENCES "RestrictedPartyScreeningResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;
