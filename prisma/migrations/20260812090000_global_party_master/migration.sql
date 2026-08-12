-- Global Party Master.
--
-- Entirely additive. No column is dropped, no column is retyped, no row is
-- deleted. `LegalEntity` is the existing party record used today by
-- `ShipmentParty`, `ProductParty` and `CustomsProfile`, and is left in place
-- and in use exactly as `CanonicalProduct` is left in place next to
-- `Product`. The only change to it is one nullable backfill column,
-- `partyId`, mirroring `CanonicalProduct.productId`.
--
-- This migration was generated with `prisma migrate diff` against the live
-- database and hand-trimmed to remove three statements that reflect
-- pre-existing drift unrelated to this feature (a `ShipmentEventLog` index,
-- a `ProductChangeEvent.impactFlags` column default, and a
-- `ProductClassification` index rename) -- none of which this migration
-- introduces or should carry.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "PartyKind" AS ENUM ('ORGANIZATION', 'INDIVIDUAL');

CREATE TYPE "PartyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED', 'ARCHIVED');

CREATE TYPE "PartyReviewStatus" AS ENUM ('UNREVIEWED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW');

CREATE TYPE "PartyNameType" AS ENUM ('LEGAL', 'TRADE', 'DBA', 'FORMER_LEGAL', 'TRANSLATED');

CREATE TYPE "PartyIdentifierType" AS ENUM ('EORI', 'DUNS', 'LEI', 'VAT', 'TAX_ID', 'CUSTOMS_ID', 'INTERNAL_PARTY_CODE', 'CUSTOMER_NUMBER', 'SUPPLIER_NUMBER', 'OTHER');

CREATE TYPE "PartyFactStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REJECTED');

CREATE TYPE "PartySourceType" AS ENUM ('DOCUMENT', 'EXTRACTED_FACT', 'ERP', 'CRM', 'USER', 'CUSTOMER_DECLARATION', 'SUPPLIER_DECLARATION', 'EXTERNAL_REGISTRY', 'IMPORT', 'AGENT', 'OTHER');

CREATE TYPE "PartyRegistrationStatus" AS ENUM ('CLAIMED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUPERSEDED');

CREATE TYPE "PartyAddressType" AS ENUM ('REGISTERED', 'MAILING', 'BILLING', 'SITE', 'OPERATING');

CREATE TYPE "PartyRoleType" AS ENUM ('IMPORTER', 'EXPORTER', 'MANUFACTURER', 'SUPPLIER', 'CUSTOMER', 'CONSIGNEE', 'CONSIGNOR', 'CARRIER', 'FREIGHT_FORWARDER', 'CUSTOMS_BROKER', 'BUYER', 'SELLER', 'NOTIFY_PARTY', 'OTHER');

CREATE TYPE "PartyRelationshipType" AS ENUM ('PARENT_OF', 'SUBSIDIARY_OF', 'AFFILIATE_OF', 'AGENT_OF', 'SUCCESSOR_OF', 'PREDECESSOR_OF');

CREATE TYPE "PartyChangeSignificance" AS ENUM ('NON_MATERIAL', 'POTENTIALLY_COMPLIANCE_SIGNIFICANT', 'COMPLIANCE_SIGNIFICANT');

CREATE TYPE "PartyImpactFlag" AS ENUM ('IDENTITY_REVALIDATION_REQUIRED', 'REGISTRATION_REVALIDATION_REQUIRED', 'ADDRESS_REVALIDATION_REQUIRED', 'SCREENING_REVALIDATION_REQUIRED');

CREATE TYPE "PartyRevalidationStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

CREATE TYPE "PartyMatchStatus" AS ENUM ('EXACT_MATCH', 'POSSIBLE_MATCH', 'AMBIGUOUS', 'NO_MATCH');

-- ---------------------------------------------------------------------------
-- LegalEntity backfill column
-- ---------------------------------------------------------------------------

ALTER TABLE "LegalEntity" ADD COLUMN     "partyId" TEXT;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "internalPartyCode" TEXT,
    "partyKind" "PartyKind" NOT NULL DEFAULT 'ORGANIZATION',
    "status" "PartyStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewStatus" "PartyReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyName" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "nameType" "PartyNameType" NOT NULL,
    "rawName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "language" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "PartyFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "PartySourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyName_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyIdentifier" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "identifierType" "PartyIdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "issuingCountry" TEXT,
    "issuingAuthority" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "PartyFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "PartySourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyIdentifier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyRegistration" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "registeringAuthority" TEXT,
    "country" TEXT NOT NULL,
    "legalForm" TEXT,
    "status" "PartyRegistrationStatus" NOT NULL DEFAULT 'CLAIMED',
    "registeredOn" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "sourceType" "PartySourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyAddress" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "addressType" "PartyAddressType" NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvince" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" "PartyFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "PartySourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyAddress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyContact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "name" TEXT,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "PartyFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "PartySourceType" NOT NULL DEFAULT 'USER',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyRole" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "roleType" "PartyRoleType" NOT NULL,
    "status" "PartyFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "PartySourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyRelationship" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fromPartyId" TEXT NOT NULL,
    "toPartyId" TEXT NOT NULL,
    "relationshipType" "PartyRelationshipType" NOT NULL,
    "status" "PartyFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "PartySourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyRelationship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartySite" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "addressId" TEXT,
    "status" "PartyFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "PartySourceType" NOT NULL DEFAULT 'USER',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartySite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyEvidence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "sourceType" "PartySourceType" NOT NULL,
    "sourceDocumentId" TEXT,
    "sourceExtractedFactId" TEXT,
    "sourceReference" TEXT,
    "sourceUrl" TEXT,
    "page" INTEGER,
    "boundingBox" JSONB,
    "tableId" TEXT,
    "rowIndex" INTEGER,
    "columnIndex" INTEGER,
    "description" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyChangeEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "significance" "PartyChangeSignificance" NOT NULL DEFAULT 'NON_MATERIAL',
    "impactFlags" "PartyImpactFlag"[],
    "changeReason" TEXT,
    "changedByUserId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyChangeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyRevalidationFlag" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "flag" "PartyImpactFlag" NOT NULL,
    "status" "PartyRevalidationStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "triggeredByChangeEventId" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyRevalidationFlag_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX "Party_accountId_deletedAt_idx" ON "Party"("accountId", "deletedAt");
CREATE INDEX "Party_accountId_status_idx" ON "Party"("accountId", "status");
CREATE INDEX "Party_accountId_reviewStatus_idx" ON "Party"("accountId", "reviewStatus");
CREATE INDEX "Party_accountId_updatedAt_idx" ON "Party"("accountId", "updatedAt");
CREATE UNIQUE INDEX "Party_accountId_internalPartyCode_key" ON "Party"("accountId", "internalPartyCode");

CREATE INDEX "PartyName_partyId_nameType_status_idx" ON "PartyName"("partyId", "nameType", "status");
CREATE INDEX "PartyName_accountId_normalizedName_idx" ON "PartyName"("accountId", "normalizedName");

CREATE INDEX "PartyIdentifier_accountId_identifierType_normalizedValue_idx" ON "PartyIdentifier"("accountId", "identifierType", "normalizedValue");
CREATE INDEX "PartyIdentifier_accountId_normalizedValue_idx" ON "PartyIdentifier"("accountId", "normalizedValue");
CREATE INDEX "PartyIdentifier_partyId_idx" ON "PartyIdentifier"("partyId");
CREATE UNIQUE INDEX "PartyIdentifier_partyId_identifierType_normalizedValue_key" ON "PartyIdentifier"("partyId", "identifierType", "normalizedValue");

CREATE INDEX "PartyRegistration_partyId_status_idx" ON "PartyRegistration"("partyId", "status");
CREATE INDEX "PartyRegistration_accountId_country_registrationNumber_idx" ON "PartyRegistration"("accountId", "country", "registrationNumber");

CREATE INDEX "PartyAddress_partyId_addressType_status_idx" ON "PartyAddress"("partyId", "addressType", "status");
CREATE INDEX "PartyAddress_accountId_country_idx" ON "PartyAddress"("accountId", "country");

CREATE INDEX "PartyContact_partyId_status_idx" ON "PartyContact"("partyId", "status");

CREATE INDEX "PartyRole_partyId_roleType_status_idx" ON "PartyRole"("partyId", "roleType", "status");
CREATE INDEX "PartyRole_accountId_roleType_idx" ON "PartyRole"("accountId", "roleType");

CREATE INDEX "PartyRelationship_fromPartyId_relationshipType_idx" ON "PartyRelationship"("fromPartyId", "relationshipType");
CREATE INDEX "PartyRelationship_toPartyId_relationshipType_idx" ON "PartyRelationship"("toPartyId", "relationshipType");
CREATE INDEX "PartyRelationship_accountId_idx" ON "PartyRelationship"("accountId");

CREATE INDEX "PartySite_partyId_status_idx" ON "PartySite"("partyId", "status");
CREATE INDEX "PartySite_addressId_idx" ON "PartySite"("addressId");

CREATE INDEX "PartyEvidence_partyId_idx" ON "PartyEvidence"("partyId");
CREATE INDEX "PartyEvidence_accountId_sourceType_idx" ON "PartyEvidence"("accountId", "sourceType");
CREATE INDEX "PartyEvidence_sourceDocumentId_idx" ON "PartyEvidence"("sourceDocumentId");
CREATE INDEX "PartyEvidence_sourceExtractedFactId_idx" ON "PartyEvidence"("sourceExtractedFactId");

CREATE INDEX "PartyChangeEvent_partyId_createdAt_idx" ON "PartyChangeEvent"("partyId", "createdAt");
CREATE INDEX "PartyChangeEvent_accountId_createdAt_idx" ON "PartyChangeEvent"("accountId", "createdAt");
CREATE INDEX "PartyChangeEvent_partyId_versionNumber_idx" ON "PartyChangeEvent"("partyId", "versionNumber");
CREATE INDEX "PartyChangeEvent_accountId_significance_idx" ON "PartyChangeEvent"("accountId", "significance");

CREATE INDEX "PartyRevalidationFlag_partyId_status_idx" ON "PartyRevalidationFlag"("partyId", "status");
CREATE INDEX "PartyRevalidationFlag_accountId_status_flag_idx" ON "PartyRevalidationFlag"("accountId", "status", "flag");

CREATE INDEX "LegalEntity_partyId_idx" ON "LegalEntity"("partyId");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Party" ADD CONSTRAINT "Party_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyName" ADD CONSTRAINT "PartyName_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyName" ADD CONSTRAINT "PartyName_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyName" ADD CONSTRAINT "PartyName_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "PartyEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartyIdentifier" ADD CONSTRAINT "PartyIdentifier_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyIdentifier" ADD CONSTRAINT "PartyIdentifier_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyIdentifier" ADD CONSTRAINT "PartyIdentifier_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "PartyEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartyRegistration" ADD CONSTRAINT "PartyRegistration_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyRegistration" ADD CONSTRAINT "PartyRegistration_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyRegistration" ADD CONSTRAINT "PartyRegistration_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "PartyEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartyAddress" ADD CONSTRAINT "PartyAddress_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyAddress" ADD CONSTRAINT "PartyAddress_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyAddress" ADD CONSTRAINT "PartyAddress_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "PartyEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartyContact" ADD CONSTRAINT "PartyContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyContact" ADD CONSTRAINT "PartyContact_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyRole" ADD CONSTRAINT "PartyRole_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyRole" ADD CONSTRAINT "PartyRole_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyRole" ADD CONSTRAINT "PartyRole_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "PartyEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartyRelationship" ADD CONSTRAINT "PartyRelationship_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyRelationship" ADD CONSTRAINT "PartyRelationship_fromPartyId_fkey" FOREIGN KEY ("fromPartyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyRelationship" ADD CONSTRAINT "PartyRelationship_toPartyId_fkey" FOREIGN KEY ("toPartyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyRelationship" ADD CONSTRAINT "PartyRelationship_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "PartyEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartySite" ADD CONSTRAINT "PartySite_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartySite" ADD CONSTRAINT "PartySite_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartySite" ADD CONSTRAINT "PartySite_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "PartyAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartyEvidence" ADD CONSTRAINT "PartyEvidence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyEvidence" ADD CONSTRAINT "PartyEvidence_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyEvidence" ADD CONSTRAINT "PartyEvidence_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "ShipmentDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartyEvidence" ADD CONSTRAINT "PartyEvidence_sourceExtractedFactId_fkey" FOREIGN KEY ("sourceExtractedFactId") REFERENCES "ExtractedFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PartyChangeEvent" ADD CONSTRAINT "PartyChangeEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyChangeEvent" ADD CONSTRAINT "PartyChangeEvent_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyRevalidationFlag" ADD CONSTRAINT "PartyRevalidationFlag_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyRevalidationFlag" ADD CONSTRAINT "PartyRevalidationFlag_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartyRevalidationFlag" ADD CONSTRAINT "PartyRevalidationFlag_triggeredByChangeEventId_fkey" FOREIGN KEY ("triggeredByChangeEventId") REFERENCES "PartyChangeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
