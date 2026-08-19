-- Generated from Prisma 6.19.3 migrate diff after applying the full migration history.
-- Reconciles the existing physical schema with prisma/schema.prisma.

-- CreateEnum
CREATE TYPE "BillingEventCategory" AS ENUM ('DOCUMENT_PROCESSING', 'CLASSIFICATION', 'HUMAN_REVIEW', 'PRODUCT_NORMALIZATION', 'RECONCILIATION', 'PGA_PROCESSING', 'EXCEPTION_RESOLUTION', 'CUSTOMS_ENTRY', 'ACE_FILING', 'ISF_FILING', 'DUTY_DRAWBACK', 'POST_SUMMARY_CORRECTION', 'MANUAL_INTERVENTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('PER_TRANSACTION', 'PER_UNIT', 'PER_SHIPMENT', 'PER_ENTRY', 'PER_DOCUMENT', 'PER_API_EVENT', 'PER_SUCCESSFUL_OUTCOME', 'FLAT_FEE', 'TIERED', 'TIME_BASED', 'PERCENTAGE_BASED', 'BUNDLED', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'RATED', 'REVIEWED', 'APPROVED', 'INVOICED', 'PAID', 'WAIVED', 'CREDITED', 'DISPUTED', 'WRITTEN_OFF', 'REVERSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'DISPUTED', 'CREDITED');

-- CreateEnum
CREATE TYPE "RateCardStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AccountMemoryType" AS ENUM ('FACT', 'PREFERENCE', 'PROCEDURE', 'DECISION', 'EXCEPTION', 'PATTERN');

-- CreateEnum
CREATE TYPE "AccountMemorySubjectType" AS ENUM ('PRODUCT', 'SUPPLIER', 'CLASSIFICATION', 'ORIGIN', 'VALUATION', 'FILING', 'SHIPMENT');

-- CreateEnum
CREATE TYPE "AccountMemorySourceType" AS ENUM ('HUMAN_DECISION', 'FILING_OUTCOME', 'VERIFIED_DOCUMENT', 'AGENT_INFERENCE');

-- Preserve legacy deadline rows before removing the obsolete enum variant.
UPDATE "ComplianceDeadline"
SET "type" = 'PROTEST_WINDOW'
WHERE "type" = 'PROTEST';

-- AlterEnum
BEGIN;
CREATE TYPE "DeadlineType_new" AS ENUM ('ISF_10_2', 'ENTRY_FILING', 'ENTRY_SUMMARY', 'DUTY_PAYMENT', 'PMS_STATEMENT', 'LAST_FREE_DAY', 'PSC_WINDOW', 'LIQUIDATION', 'PROTEST_WINDOW', 'CIT_APPEAL_WINDOW', 'DEEMED_DENIAL', 'CF28_RESPONSE', 'CF29_RESPONSE');
ALTER TABLE "ComplianceDeadline" ALTER COLUMN "type" TYPE "DeadlineType_new" USING ("type"::text::"DeadlineType_new");
ALTER TYPE "DeadlineType" RENAME TO "DeadlineType_old";
ALTER TYPE "DeadlineType_new" RENAME TO "DeadlineType";
DROP TYPE "public"."DeadlineType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "AccountMembership" DROP CONSTRAINT "AccountMembership_roleId_fkey";
ALTER TABLE "Protest" DROP CONSTRAINT "Protest_accountId_fkey";
ALTER TABLE "Protest" DROP CONSTRAINT "Protest_linkedPscId_fkey";
ALTER TABLE "ProtestAttachment" DROP CONSTRAINT "ProtestAttachment_protestId_fkey";
ALTER TABLE "ProtestEntry" DROP CONSTRAINT "ProtestEntry_filingId_fkey";
ALTER TABLE "ProtestEntry" DROP CONSTRAINT "ProtestEntry_protestId_fkey";
ALTER TABLE "ProtestNote" DROP CONSTRAINT "ProtestNote_protestId_fkey";
ALTER TABLE "PscAttachment" DROP CONSTRAINT "PscAttachment_pscId_fkey";
ALTER TABLE "ShipmentDocument" DROP CONSTRAINT "ShipmentDocument_shipmentId_fkey";

-- DropIndex
DROP INDEX "AdCvdCompanyRate_countryOfOrigin_idx";
DROP INDEX "Shipment_scenarioId_idx";

-- AccountMembershipRole is the canonical many-to-many role model. Preserve
-- every existing legacy single-role assignment before removing roleId.
INSERT INTO "AccountMembershipRole" ("accountMembershipId", "roleId")
SELECT "id", "roleId"
FROM "AccountMembership"
WHERE "roleId" IS NOT NULL
ON CONFLICT ("accountMembershipId", "roleId") DO NOTHING;

ALTER TABLE "AccountMembership" DROP COLUMN "roleId";

ALTER TABLE "AcePortCode" ALTER COLUMN "transportModes" DROP DEFAULT;

ALTER TABLE "AgentPolicyConfig" ADD COLUMN "minimumReviewerRole" TEXT DEFAULT 'SPECIALIST',
ADD COLUMN "policyType" TEXT NOT NULL DEFAULT 'THRESHOLD',
ADD COLUMN "requireHumanApproval" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AuditLog" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'UI';

ALTER TABLE "CustomsFiling" ALTER COLUMN "shipmentId" DROP NOT NULL;

ALTER TABLE "DeniedPartyWatchlist" ADD COLUMN "listVersion" TEXT,
ADD COLUMN "publishDate" TIMESTAMP(3);

ALTER TABLE "DocumentShipmentCandidate" ADD COLUMN "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

ALTER TABLE "ExceptionItem" ADD COLUMN "blocking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "category" TEXT,
ADD COLUMN "code" TEXT,
ADD COLUMN "requiredAction" TEXT,
ADD COLUMN "resolvedBy" TEXT,
ADD COLUMN "sourceAgent" TEXT;

ALTER TABLE "HtsDutyRate" ADD COLUMN "caseNumber" TEXT,
ADD COLUMN "countryOfOrigin" TEXT,
ADD COLUMN "manufacturer" TEXT,
ADD COLUMN "trancheId" TEXT;

ALTER TABLE "LandedCostScenario" ADD COLUMN "htsReleaseId" TEXT,
ADD COLUMN "manufacturer" TEXT,
ADD COLUMN "tradeAgreementClaim" TEXT;

ALTER TABLE "LandedCostScenarioLineItem" ADD COLUMN "dutyStack" JSONB,
ADD COLUMN "manufacturer" TEXT,
ADD COLUMN "tradeAgreementClaim" TEXT;

ALTER TABLE "Party" ADD COLUMN "clientId" TEXT;

ALTER TABLE "PostSummaryCorrection" ALTER COLUMN "dutyDelta" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "interestEstimate" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "correctedValue" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "correctedQuantity" SET DATA TYPE DECIMAL(65,30);

ALTER TABLE "Product" ADD COLUMN "clientId" TEXT;

ALTER TABLE "Protest" ALTER COLUMN "claimAmount" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "ProtestEntry" ALTER COLUMN "dutyAssessed" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "dutyContested" SET DATA TYPE DECIMAL(65,30);

ALTER TABLE "ReconciliationIssue" ADD COLUMN "issueType" TEXT NOT NULL DEFAULT 'DOCUMENT_CONFLICT',
ADD COLUMN "note" TEXT,
ADD COLUMN "resolution" TEXT,
ADD COLUMN "resolvedByUserId" TEXT,
ADD COLUMN "resolvedByUserName" TEXT;

ALTER TABLE "RefundOpportunity" ALTER COLUMN "estimatedRefundAmount" DROP NOT NULL;

ALTER TABLE "ScreeningEntity" ALTER COLUMN "alternateNames" DROP DEFAULT,
ALTER COLUMN "programCodes" DROP DEFAULT;

ALTER TABLE "ScreeningLog" ADD COLUMN "listVersion" TEXT,
ADD COLUMN "publishDate" TIMESTAMP(3);

ALTER TABLE "ShipmentDocument" ADD COLUMN "extractedJson" TEXT,
ADD COLUMN "rawContent" TEXT,
ALTER COLUMN "shipmentId" DROP NOT NULL;

ALTER TABLE "ShipmentLineItem" ADD COLUMN "dutyStack" JSONB;
