-- Migration: Add dataset reference tables
-- These are platform-level reference tables (no accountId — not tenant data).
-- Sources documented in docs/data/data-refresh-policy.md

-- Persistent per-dataset ingestion run log
CREATE TABLE "DatasetRefreshLog" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "datasetName" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "errorMessage" TEXT,
    "itemsIngested" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DatasetRefreshLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DatasetRefreshLog_datasetId_idx" ON "DatasetRefreshLog"("datasetId");
CREATE INDEX "DatasetRefreshLog_status_idx" ON "DatasetRefreshLog"("status");
CREATE INDEX "DatasetRefreshLog_startedAt_idx" ON "DatasetRefreshLog"("startedAt");

-- Normalized entity records from BIS CSL + OFAC SDN (10 lists merged)
-- Versioned for point-in-time audit defensibility
CREATE TABLE "ScreeningEntity" (
    "id" TEXT NOT NULL,
    "entityHash" TEXT NOT NULL,
    "sourceList" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alternateNames" TEXT[] NOT NULL DEFAULT '{}',
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "nationalityCountry" TEXT,
    "programCodes" TEXT[] NOT NULL DEFAULT '{}',
    "remarks" TEXT,
    "publicationStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "sourcePublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningEntity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScreeningEntity_entityHash_key" ON "ScreeningEntity"("entityHash");
CREATE INDEX "ScreeningEntity_name_idx" ON "ScreeningEntity"("name");
CREATE INDEX "ScreeningEntity_sourceList_idx" ON "ScreeningEntity"("sourceList");
CREATE INDEX "ScreeningEntity_publicationStatus_idx" ON "ScreeningEntity"("publicationStatus");
CREATE INDEX "ScreeningEntity_country_idx" ON "ScreeningEntity"("country");

-- CBP ACE port codes reference table
CREATE TABLE "AcePortCode" (
    "id" TEXT NOT NULL,
    "portCode" TEXT NOT NULL,
    "portName" TEXT NOT NULL,
    "state" TEXT,
    "fieldOfficeCode" TEXT,
    "transportModes" TEXT[] NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcePortCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AcePortCode_portCode_key" ON "AcePortCode"("portCode");
CREATE INDEX "AcePortCode_portCode_idx" ON "AcePortCode"("portCode");
CREATE INDEX "AcePortCode_isActive_idx" ON "AcePortCode"("isActive");

-- Section 301 tariff rates per-HTS tranche
-- LLM-extracted rows: reviewStatus=PENDING until admin approves
CREATE TABLE "Section301Rate" (
    "id" TEXT NOT NULL,
    "htsNumber" TEXT NOT NULL,
    "tranche" TEXT NOT NULL,
    "dutyRatePct" DOUBLE PRECISION NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3),
    "federalRegisterCitation" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section301Rate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Section301Rate_htsNumber_tranche_effectiveDate_key" ON "Section301Rate"("htsNumber", "tranche", "effectiveDate");
CREATE INDEX "Section301Rate_htsNumber_idx" ON "Section301Rate"("htsNumber");
CREATE INDEX "Section301Rate_tranche_idx" ON "Section301Rate"("tranche");
CREATE INDEX "Section301Rate_reviewStatus_idx" ON "Section301Rate"("reviewStatus");

-- Section 301 exclusions
-- LLM-extracted; must be approved before triggering RefundOpportunity auto-creation
CREATE TABLE "Section301Exclusion" (
    "id" TEXT NOT NULL,
    "htsNumber" TEXT NOT NULL,
    "productDescriptionRaw" TEXT NOT NULL,
    "productDescriptionRegex" TEXT,
    "tranche" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3),
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "federalRegisterCitation" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section301Exclusion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Section301Exclusion_htsNumber_idx" ON "Section301Exclusion"("htsNumber");
CREATE INDEX "Section301Exclusion_isExpired_idx" ON "Section301Exclusion"("isExpired");
CREATE INDEX "Section301Exclusion_reviewStatus_idx" ON "Section301Exclusion"("reviewStatus");

-- Section 232 (Steel/Aluminum) rates and TRQs
CREATE TABLE "Section232Rate" (
    "id" TEXT NOT NULL,
    "htsNumber" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "baseRatePct" DOUBLE PRECISION NOT NULL,
    "countryOfOrigin" TEXT,
    "isGeneralApprovedExclusion" BOOLEAN NOT NULL DEFAULT false,
    "trqQuotaKg" DOUBLE PRECISION,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3),
    "reviewStatus" TEXT NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section232Rate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Section232Rate_htsNumber_idx" ON "Section232Rate"("htsNumber");
CREATE INDEX "Section232Rate_commodity_idx" ON "Section232Rate"("commodity");
CREATE INDEX "Section232Rate_countryOfOrigin_idx" ON "Section232Rate"("countryOfOrigin");

-- Product-Specific Rules for USMCA Annex 4-B and CAFTA-DR Annex 4.1
CREATE TABLE "TradeAgreementRule" (
    "id" TEXT NOT NULL,
    "agreementCode" TEXT NOT NULL,
    "hsChapter" TEXT,
    "hsHeading" TEXT,
    "hsSubheading" TEXT,
    "ruleType" TEXT NOT NULL,
    "ruleText" TEXT NOT NULL,
    "tariffShiftFrom" TEXT,
    "rvcMethod" TEXT,
    "rvcPct" DOUBLE PRECISION,
    "exceptions" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeAgreementRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TradeAgreementRule_agreementCode_idx" ON "TradeAgreementRule"("agreementCode");
CREATE INDEX "TradeAgreementRule_hsChapter_idx" ON "TradeAgreementRule"("hsChapter");
CREATE INDEX "TradeAgreementRule_hsHeading_idx" ON "TradeAgreementRule"("hsHeading");

-- WTO MFN and preferential tariff rates by HS-6
CREATE TABLE "WtoTariffRate" (
    "id" TEXT NOT NULL,
    "reporterIso2" TEXT NOT NULL,
    "partnerIso2" TEXT,
    "hsCode6" TEXT NOT NULL,
    "tariffYear" INTEGER NOT NULL,
    "rateType" TEXT NOT NULL,
    "adValoremPct" DOUBLE PRECISION,
    "specificRate" TEXT,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "tradeAgreement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WtoTariffRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WtoTariffRate_reporterIso2_partnerIso2_hsCode6_tariffYear_rateType_key"
    ON "WtoTariffRate"("reporterIso2", "partnerIso2", "hsCode6", "tariffYear", "rateType");
CREATE INDEX "WtoTariffRate_hsCode6_idx" ON "WtoTariffRate"("hsCode6");
CREATE INDEX "WtoTariffRate_reporterIso2_idx" ON "WtoTariffRate"("reporterIso2");
CREATE INDEX "WtoTariffRate_tariffYear_idx" ON "WtoTariffRate"("tariffYear");

-- CBP monthly import trade trend statistics
CREATE TABLE "CbpImportTrend" (
    "id" TEXT NOT NULL,
    "reportingPeriod" TIMESTAMP(3) NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "customsValueUsd" DECIMAL(65,30) NOT NULL,
    "dutyCollectedUsd" DECIMAL(65,30) NOT NULL,
    "topCommodities" JSONB NOT NULL,
    "sourceReportUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CbpImportTrend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CbpImportTrend_reportingPeriod_key" ON "CbpImportTrend"("reportingPeriod");
CREATE INDEX "CbpImportTrend_reportingPeriod_idx" ON "CbpImportTrend"("reportingPeriod");

-- US Census Schedule B export codes with HTS concordance
CREATE TABLE "ScheduleBCode" (
    "id" TEXT NOT NULL,
    "scheduleBNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantityUnit1" TEXT,
    "quantityUnit2" TEXT,
    "hts10Concordance" TEXT,
    "effectiveYear" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleBCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScheduleBCode_scheduleBNumber_key" ON "ScheduleBCode"("scheduleBNumber");
CREATE INDEX "ScheduleBCode_scheduleBNumber_idx" ON "ScheduleBCode"("scheduleBNumber");
CREATE INDEX "ScheduleBCode_hts10Concordance_idx" ON "ScheduleBCode"("hts10Concordance");

-- AD/CVD company-specific cash deposit rates from Commerce ITAD
-- LLM-extracted; must be approved before affecting duty calculations
CREATE TABLE "AdCvdCompanyRate" (
    "id" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "periodOfReview" TEXT NOT NULL,
    "manufacturerName" TEXT NOT NULL,
    "exporterName" TEXT,
    "countryOfOrigin" TEXT NOT NULL,
    "depositRatePct" DOUBLE PRECISION,
    "allOthersRatePct" DOUBLE PRECISION,
    "isSeparateRate" BOOLEAN NOT NULL DEFAULT true,
    "federalRegisterCitation" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCvdCompanyRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdCvdCompanyRate_caseNumber_idx" ON "AdCvdCompanyRate"("caseNumber");
CREATE INDEX "AdCvdCompanyRate_manufacturerName_idx" ON "AdCvdCompanyRate"("manufacturerName");
CREATE INDEX "AdCvdCompanyRate_reviewStatus_idx" ON "AdCvdCompanyRate"("reviewStatus");
CREATE INDEX "AdCvdCompanyRate_countryOfOrigin_idx" ON "AdCvdCompanyRate"("countryOfOrigin");
