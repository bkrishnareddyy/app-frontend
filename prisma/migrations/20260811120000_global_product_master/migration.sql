-- Global Product / Item Master.
--
-- Entirely additive. No column is dropped, no column is retyped, no row is
-- deleted. The legacy `CanonicalProduct` table is left in place and in use; the
-- data migration at the end copies its facts into the new model and links the
-- two, so nothing that exists today stops working.
--
-- The one judgement this migration makes is about honesty of status. A legacy
-- `CanonicalProduct.htsCode` was never reviewed by anyone, so it arrives as a
-- CANDIDATE US/HTSUS classification and not as an APPROVED one; a legacy
-- `countryOfOrigin` arrives as a CLAIMED origin claim and not as a manufacture
-- country or a verified origin.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED', 'ARCHIVED');

CREATE TYPE "ProductReviewStatus" AS ENUM ('UNREVIEWED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW');

CREATE TYPE "ProductIdentifierType" AS ENUM ('INTERNAL_SKU', 'CUSTOMER_SKU', 'SUPPLIER_SKU', 'MANUFACTURER_PART_NUMBER', 'MODEL_NUMBER', 'GTIN', 'UPC', 'EAN', 'STYLE_NUMBER', 'OTHER');

CREATE TYPE "ProductAttributeValueType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'ENUM', 'JSON');

CREATE TYPE "ProductFactStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REJECTED');

CREATE TYPE "ProductSourceType" AS ENUM ('DOCUMENT', 'EXTRACTED_FACT', 'ERP', 'PIM', 'USER', 'MANUFACTURER_DATASHEET', 'SUPPLIER_DECLARATION', 'CUSTOMS_RULING', 'REGULATORY_SOURCE', 'IMPORT', 'AGENT', 'OTHER');

CREATE TYPE "ProductPartyRole" AS ENUM ('MANUFACTURER', 'SUPPLIER', 'BRAND_OWNER');

CREATE TYPE "ProductCountryFactType" AS ENUM ('MANUFACTURE_COUNTRY', 'PRODUCTION_COUNTRY', 'ORIGIN_CLAIM');

CREATE TYPE "ProductCountryFactStatus" AS ENUM ('CLAIMED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUPERSEDED');

CREATE TYPE "ProductClassificationStatus" AS ENUM ('CANDIDATE', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'EXPIRED');

CREATE TYPE "ProductClassificationMethod" AS ENUM ('MANUAL', 'IMPORT', 'AGENT_PROPOSED', 'RULING_BASED');

CREATE TYPE "ProductChangeSignificance" AS ENUM ('NON_MATERIAL', 'POTENTIALLY_CUSTOMS_SIGNIFICANT', 'CUSTOMS_SIGNIFICANT');

CREATE TYPE "ProductImpactFlag" AS ENUM ('CLASSIFICATION_REVALIDATION_REQUIRED', 'ORIGIN_REVALIDATION_REQUIRED', 'REGULATORY_REVALIDATION_REQUIRED', 'VALUATION_REVIEW_REQUIRED');

CREATE TYPE "ProductRevalidationStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

CREATE TYPE "ProductMatchStatus" AS ENUM ('EXACT_MATCH', 'POSSIBLE_MATCH', 'AMBIGUOUS', 'NO_MATCH');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "internalSku" TEXT,
    "productName" TEXT NOT NULL,
    "commercialDescription" TEXT,
    "technicalDescription" TEXT,
    "customsDescription" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewStatus" "ProductReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductIdentifier" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "identifierType" "ProductIdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "issuerPartyId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" "ProductSourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductIdentifier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductEvidence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceType" "ProductSourceType" NOT NULL,
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

    CONSTRAINT "ProductEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductAttribute" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "attributeCode" TEXT NOT NULL,
    "attributeName" TEXT NOT NULL,
    "rawValue" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "valueType" "ProductAttributeValueType" NOT NULL DEFAULT 'STRING',
    "rawUnit" TEXT,
    "normalizedUnit" TEXT,
    "status" "ProductFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "ProductSourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAttribute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductComposition" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "componentName" TEXT,
    "percentage" DECIMAL(7,4),
    "quantity" DECIMAL(18,6),
    "unit" TEXT,
    "normalizedUnit" TEXT,
    "grade" TEXT,
    "alloy" TEXT,
    "chemicalIdentifier" TEXT,
    "isCompleteDeclaration" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProductFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "ProductSourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductComposition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductParty" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "role" "ProductPartyRole" NOT NULL,
    "manufacturingSite" TEXT,
    "status" "ProductFactStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "ProductSourceType" NOT NULL DEFAULT 'USER',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductParty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductCountryFact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "factType" "ProductCountryFactType" NOT NULL,
    "rawCountry" TEXT NOT NULL,
    "countryCode" TEXT,
    "status" "ProductCountryFactStatus" NOT NULL DEFAULT 'CLAIMED',
    "sourceType" "ProductSourceType" NOT NULL DEFAULT 'USER',
    "sourceReference" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "evidenceId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCountryFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductClassification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "nomenclature" TEXT NOT NULL,
    "classificationCode" TEXT NOT NULL,
    "normalizedCode" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProductClassificationStatus" NOT NULL DEFAULT 'CANDIDATE',
    "decisionSource" "ProductSourceType" NOT NULL DEFAULT 'USER',
    "decisionMethod" "ProductClassificationMethod" NOT NULL DEFAULT 'MANUAL',
    "decisionVersion" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "supersededById" TEXT,
    "evidenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductClassification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductChangeEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "significance" "ProductChangeSignificance" NOT NULL DEFAULT 'NON_MATERIAL',
    "impactFlags" "ProductImpactFlag"[] DEFAULT ARRAY[]::"ProductImpactFlag"[],
    "changeReason" TEXT,
    "changedByUserId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductChangeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductRevalidationFlag" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "flag" "ProductImpactFlag" NOT NULL,
    "status" "ProductRevalidationStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "triggeredByChangeEventId" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRevalidationFlag_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Additive columns on existing tables
-- ---------------------------------------------------------------------------

-- Nullable throughout: an unmatched shipment line is a normal, filable state,
-- and no existing row is being asserted to belong to any product.
ALTER TABLE "ShipmentLineItem" ADD COLUMN "productId" TEXT;
ALTER TABLE "ShipmentLineItem" ADD COLUMN "productMatchStatus" "ProductMatchStatus";
ALTER TABLE "ShipmentLineItem" ADD COLUMN "productMatchedAt" TIMESTAMP(3);

ALTER TABLE "CanonicalProduct" ADD COLUMN "productId" TEXT;

-- ---------------------------------------------------------------------------
-- Indexes and constraints
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "Product_accountId_internalSku_key" ON "Product"("accountId", "internalSku");
CREATE INDEX "Product_accountId_deletedAt_idx" ON "Product"("accountId", "deletedAt");
CREATE INDEX "Product_accountId_status_idx" ON "Product"("accountId", "status");
CREATE INDEX "Product_accountId_reviewStatus_idx" ON "Product"("accountId", "reviewStatus");
CREATE INDEX "Product_accountId_productName_idx" ON "Product"("accountId", "productName");
CREATE INDEX "Product_accountId_updatedAt_idx" ON "Product"("accountId", "updatedAt");
CREATE INDEX "Product_accountId_brand_idx" ON "Product"("accountId", "brand");
CREATE INDEX "Product_accountId_model_idx" ON "Product"("accountId", "model");

CREATE UNIQUE INDEX "ProductIdentifier_productId_identifierType_normalizedValue_key" ON "ProductIdentifier"("productId", "identifierType", "normalizedValue");
CREATE INDEX "ProductIdentifier_accountId_identifierType_normalizedValue_idx" ON "ProductIdentifier"("accountId", "identifierType", "normalizedValue");
CREATE INDEX "ProductIdentifier_accountId_normalizedValue_idx" ON "ProductIdentifier"("accountId", "normalizedValue");
CREATE INDEX "ProductIdentifier_productId_idx" ON "ProductIdentifier"("productId");

CREATE INDEX "ProductEvidence_productId_idx" ON "ProductEvidence"("productId");
CREATE INDEX "ProductEvidence_accountId_sourceType_idx" ON "ProductEvidence"("accountId", "sourceType");
CREATE INDEX "ProductEvidence_sourceDocumentId_idx" ON "ProductEvidence"("sourceDocumentId");
CREATE INDEX "ProductEvidence_sourceExtractedFactId_idx" ON "ProductEvidence"("sourceExtractedFactId");

CREATE INDEX "ProductAttribute_productId_attributeCode_status_idx" ON "ProductAttribute"("productId", "attributeCode", "status");
CREATE INDEX "ProductAttribute_accountId_attributeCode_idx" ON "ProductAttribute"("accountId", "attributeCode");
CREATE INDEX "ProductAttribute_accountId_attributeCode_normalizedValue_idx" ON "ProductAttribute"("accountId", "attributeCode", "normalizedValue");

CREATE INDEX "ProductComposition_productId_status_idx" ON "ProductComposition"("productId", "status");
CREATE INDEX "ProductComposition_accountId_material_idx" ON "ProductComposition"("accountId", "material");

CREATE INDEX "ProductParty_productId_role_status_idx" ON "ProductParty"("productId", "role", "status");
CREATE INDEX "ProductParty_accountId_legalEntityId_idx" ON "ProductParty"("accountId", "legalEntityId");

CREATE INDEX "ProductCountryFact_productId_factType_status_idx" ON "ProductCountryFact"("productId", "factType", "status");
CREATE INDEX "ProductCountryFact_accountId_factType_countryCode_idx" ON "ProductCountryFact"("accountId", "factType", "countryCode");

CREATE UNIQUE INDEX "ProductClassification_supersededById_key" ON "ProductClassification"("supersededById");
CREATE INDEX "ProductClassification_productId_jurisdiction_status_idx" ON "ProductClassification"("productId", "jurisdiction", "status");
CREATE INDEX "ProductClassification_accountId_jurisdiction_nomenclature_normalizedCode_idx" ON "ProductClassification"("accountId", "jurisdiction", "nomenclature", "normalizedCode");
CREATE INDEX "ProductClassification_accountId_status_idx" ON "ProductClassification"("accountId", "status");
CREATE INDEX "ProductClassification_productId_effectiveFrom_idx" ON "ProductClassification"("productId", "effectiveFrom");

CREATE INDEX "ProductChangeEvent_productId_createdAt_idx" ON "ProductChangeEvent"("productId", "createdAt");
CREATE INDEX "ProductChangeEvent_accountId_createdAt_idx" ON "ProductChangeEvent"("accountId", "createdAt");
CREATE INDEX "ProductChangeEvent_productId_versionNumber_idx" ON "ProductChangeEvent"("productId", "versionNumber");
CREATE INDEX "ProductChangeEvent_accountId_significance_idx" ON "ProductChangeEvent"("accountId", "significance");

CREATE INDEX "ProductRevalidationFlag_productId_status_idx" ON "ProductRevalidationFlag"("productId", "status");
CREATE INDEX "ProductRevalidationFlag_accountId_status_flag_idx" ON "ProductRevalidationFlag"("accountId", "status", "flag");

CREATE INDEX "ShipmentLineItem_productId_idx" ON "ShipmentLineItem"("productId");
CREATE INDEX "CanonicalProduct_productId_idx" ON "CanonicalProduct"("productId");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

ALTER TABLE "Product" ADD CONSTRAINT "Product_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductIdentifier" ADD CONSTRAINT "ProductIdentifier_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductIdentifier" ADD CONSTRAINT "ProductIdentifier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductIdentifier" ADD CONSTRAINT "ProductIdentifier_issuerPartyId_fkey" FOREIGN KEY ("issuerPartyId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductEvidence" ADD CONSTRAINT "ProductEvidence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductEvidence" ADD CONSTRAINT "ProductEvidence_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductEvidence" ADD CONSTRAINT "ProductEvidence_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "ShipmentDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductEvidence" ADD CONSTRAINT "ProductEvidence_sourceExtractedFactId_fkey" FOREIGN KEY ("sourceExtractedFactId") REFERENCES "ExtractedFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductAttribute" ADD CONSTRAINT "ProductAttribute_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAttribute" ADD CONSTRAINT "ProductAttribute_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAttribute" ADD CONSTRAINT "ProductAttribute_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProductEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductComposition" ADD CONSTRAINT "ProductComposition_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductComposition" ADD CONSTRAINT "ProductComposition_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductComposition" ADD CONSTRAINT "ProductComposition_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProductEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductParty" ADD CONSTRAINT "ProductParty_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductParty" ADD CONSTRAINT "ProductParty_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductParty" ADD CONSTRAINT "ProductParty_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductParty" ADD CONSTRAINT "ProductParty_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProductEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductCountryFact" ADD CONSTRAINT "ProductCountryFact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCountryFact" ADD CONSTRAINT "ProductCountryFact_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCountryFact" ADD CONSTRAINT "ProductCountryFact_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProductEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductClassification" ADD CONSTRAINT "ProductClassification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductClassification" ADD CONSTRAINT "ProductClassification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductClassification" ADD CONSTRAINT "ProductClassification_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "ProductClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductClassification" ADD CONSTRAINT "ProductClassification_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProductEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductChangeEvent" ADD CONSTRAINT "ProductChangeEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductChangeEvent" ADD CONSTRAINT "ProductChangeEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductRevalidationFlag" ADD CONSTRAINT "ProductRevalidationFlag_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductRevalidationFlag" ADD CONSTRAINT "ProductRevalidationFlag_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductRevalidationFlag" ADD CONSTRAINT "ProductRevalidationFlag_triggeredByChangeEventId_fkey" FOREIGN KEY ("triggeredByChangeEventId") REFERENCES "ProductChangeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShipmentLineItem" ADD CONSTRAINT "ShipmentLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CanonicalProduct" ADD CONSTRAINT "CanonicalProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data migration: CanonicalProduct -> Product
--
-- Every existing CanonicalProduct row gains a Product carrying the same facts,
-- restated under the model that keeps them apart. The CanonicalProduct row is
-- kept and linked; nothing is deleted.
--
-- Statuses are chosen so the migration cannot make anything look more settled
-- than it is:
--   * products arrive ACTIVE (they are in use) but UNREVIEWED (nobody reviewed
--     them);
--   * `htsCode` becomes a CANDIDATE US/HTSUS classification, never APPROVED;
--   * `countryOfOrigin` becomes a CLAIMED origin claim, never a manufacture
--     country and never VERIFIED;
--   * `manufacturer` is only linked as a party where a LegalEntity in the same
--     account already carries exactly that legal name. Where it does not, the
--     string is preserved in a change event rather than conjuring a party.
-- ---------------------------------------------------------------------------

-- A deterministic id per source row, so re-running this block after a failure
-- cannot produce a second Product for the same CanonicalProduct.
CREATE TEMPORARY TABLE "_cp_migration" AS
SELECT
    cp."id"        AS canonical_id,
    cp."accountId" AS account_id,
    'cpm_' || replace(cp."id", '-', '') AS product_id,
    cp."canonicalName",
    cp."sku",
    cp."partNumber",
    cp."manufacturer",
    cp."countryOfOrigin",
    cp."htsCode",
    cp."createdAt",
    cp."updatedAt",
    -- An account may hold several canonical rows sharing one SKU. Only the
    -- first may claim Product.internalSku; the rest still get the SKU as an
    -- identifier row, which carries no cross-product uniqueness.
    ROW_NUMBER() OVER (
        PARTITION BY cp."accountId", lower(trim(cp."sku"))
        ORDER BY cp."createdAt", cp."id"
    ) AS sku_rank
FROM "CanonicalProduct" cp
WHERE cp."productId" IS NULL;

INSERT INTO "Product" (
    "id", "accountId", "internalSku", "productName", "commercialDescription",
    "status", "reviewStatus", "currentVersion", "createdAt", "updatedAt"
)
SELECT
    m.product_id,
    m.account_id,
    CASE WHEN m."sku" IS NOT NULL AND trim(m."sku") <> '' AND m.sku_rank = 1
         THEN trim(m."sku") END,
    m."canonicalName",
    m."canonicalName",
    'ACTIVE'::"ProductStatus",
    'UNREVIEWED'::"ProductReviewStatus",
    1,
    m."createdAt",
    m."updatedAt"
FROM "_cp_migration" m;

INSERT INTO "ProductIdentifier" (
    "id", "accountId", "productId", "identifierType", "value", "normalizedValue",
    "isPrimary", "sourceType", "effectiveFrom", "createdAt", "updatedAt"
)
SELECT
    m.product_id || '_sku',
    m.account_id,
    m.product_id,
    'INTERNAL_SKU'::"ProductIdentifierType",
    trim(m."sku"),
    upper(trim(m."sku")),
    true,
    'IMPORT'::"ProductSourceType",
    m."createdAt",
    m."createdAt",
    m."updatedAt"
FROM "_cp_migration" m
WHERE m."sku" IS NOT NULL AND trim(m."sku") <> '';

INSERT INTO "ProductIdentifier" (
    "id", "accountId", "productId", "identifierType", "value", "normalizedValue",
    "isPrimary", "sourceType", "effectiveFrom", "createdAt", "updatedAt"
)
SELECT
    m.product_id || '_mpn',
    m.account_id,
    m.product_id,
    'MANUFACTURER_PART_NUMBER'::"ProductIdentifierType",
    trim(m."partNumber"),
    upper(trim(m."partNumber")),
    false,
    'IMPORT'::"ProductSourceType",
    m."createdAt",
    m."createdAt",
    m."updatedAt"
FROM "_cp_migration" m
WHERE m."partNumber" IS NOT NULL AND trim(m."partNumber") <> '';

-- Origin claim, not manufacture country, and CLAIMED rather than VERIFIED: the
-- legacy column recorded an assertion whose source and evidence were never kept.
INSERT INTO "ProductCountryFact" (
    "id", "accountId", "productId", "factType", "rawCountry", "countryCode",
    "status", "sourceType", "sourceReference", "effectiveFrom", "createdAt", "updatedAt"
)
SELECT
    m.product_id || '_origin',
    m.account_id,
    m.product_id,
    'ORIGIN_CLAIM'::"ProductCountryFactType",
    trim(m."countryOfOrigin"),
    -- Resolved only when the legacy value is already an ISO alpha-2 code. A
    -- country name is left unresolved rather than guessed at in SQL.
    CASE WHEN trim(m."countryOfOrigin") ~ '^[A-Za-z]{2}$'
         THEN upper(trim(m."countryOfOrigin")) END,
    'CLAIMED'::"ProductCountryFactStatus",
    'IMPORT'::"ProductSourceType",
    'Migrated from CanonicalProduct.countryOfOrigin; original source and evidence were not recorded.',
    m."createdAt",
    m."createdAt",
    m."updatedAt"
FROM "_cp_migration" m
WHERE m."countryOfOrigin" IS NOT NULL AND trim(m."countryOfOrigin") <> '';

-- CANDIDATE, never APPROVED. The legacy column held no reviewer, no review
-- date, and no evidence, so it cannot be presented as an approved position.
INSERT INTO "ProductClassification" (
    "id", "accountId", "productId", "jurisdiction", "nomenclature",
    "classificationCode", "normalizedCode", "description", "status",
    "decisionSource", "decisionMethod", "decisionVersion",
    "effectiveFrom", "createdAt", "updatedAt"
)
SELECT
    m.product_id || '_us',
    m.account_id,
    m.product_id,
    'US',
    'HTSUS',
    trim(m."htsCode"),
    regexp_replace(m."htsCode", '[^0-9]', '', 'g'),
    'Migrated from CanonicalProduct.htsCode. Never reviewed or approved in Qubere.',
    'CANDIDATE'::"ProductClassificationStatus",
    'IMPORT'::"ProductSourceType",
    'IMPORT'::"ProductClassificationMethod",
    1,
    m."createdAt",
    m."createdAt",
    m."updatedAt"
FROM "_cp_migration" m
WHERE m."htsCode" IS NOT NULL
  AND trim(m."htsCode") <> ''
  AND regexp_replace(m."htsCode", '[^0-9]', '', 'g') <> '';

-- Manufacturer, linked only where the account already holds a legal entity with
-- exactly that legal name.
INSERT INTO "ProductParty" (
    "id", "accountId", "productId", "legalEntityId", "role", "status",
    "sourceType", "effectiveFrom", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (m.product_id)
    m.product_id || '_mfr',
    m.account_id,
    m.product_id,
    le."id",
    'MANUFACTURER'::"ProductPartyRole",
    'ACTIVE'::"ProductFactStatus",
    'IMPORT'::"ProductSourceType",
    m."createdAt",
    m."createdAt",
    m."updatedAt"
FROM "_cp_migration" m
JOIN "LegalEntity" le
  ON le."accountId" = m.account_id
 AND lower(trim(le."legalName")) = lower(trim(m."manufacturer"))
WHERE m."manufacturer" IS NOT NULL AND trim(m."manufacturer") <> ''
ORDER BY m.product_id, le."createdAt", le."id";

-- Provenance for the migration itself, including the manufacturer names that
-- could not be resolved to a party. Nothing is silently dropped.
INSERT INTO "ProductChangeEvent" (
    "id", "accountId", "productId", "versionNumber", "entity", "field",
    "oldValue", "newValue", "significance", "impactFlags", "changeReason", "createdAt"
)
SELECT
    m.product_id || '_migrated',
    m.account_id,
    m.product_id,
    1,
    'Product',
    'migratedFromCanonicalProduct',
    NULL,
    m.canonical_id,
    'NON_MATERIAL'::"ProductChangeSignificance",
    ARRAY[]::"ProductImpactFlag"[],
    'Created by the Global Product Master migration from CanonicalProduct. Legacy HTS code recorded as a US/HTSUS CANDIDATE and legacy country of origin as a CLAIMED origin claim, because neither was ever reviewed.',
    m."updatedAt"
FROM "_cp_migration" m;

INSERT INTO "ProductChangeEvent" (
    "id", "accountId", "productId", "versionNumber", "entity", "field",
    "oldValue", "newValue", "significance", "impactFlags", "changeReason", "createdAt"
)
SELECT
    m.product_id || '_mfr_unresolved',
    m.account_id,
    m.product_id,
    1,
    'ProductParty:MANUFACTURER',
    'manufacturerName',
    NULL,
    trim(m."manufacturer"),
    'POTENTIALLY_CUSTOMS_SIGNIFICANT'::"ProductChangeSignificance",
    ARRAY[]::"ProductImpactFlag"[],
    'Legacy manufacturer name preserved. No legal entity in this account carries that name, so no manufacturer party was created rather than inventing one.',
    m."updatedAt"
FROM "_cp_migration" m
WHERE m."manufacturer" IS NOT NULL
  AND trim(m."manufacturer") <> ''
  AND NOT EXISTS (
      SELECT 1 FROM "LegalEntity" le
      WHERE le."accountId" = m.account_id
        AND lower(trim(le."legalName")) = lower(trim(m."manufacturer"))
  );

UPDATE "CanonicalProduct" cp
SET "productId" = m.product_id
FROM "_cp_migration" m
WHERE cp."id" = m.canonical_id;

DROP TABLE "_cp_migration";
