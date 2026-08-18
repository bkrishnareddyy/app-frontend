-- Creates billing tables and adds columns not covered by
-- 20260818195000_align_prisma_schema_core. Enums (PricingModel, ChargeStatus,
-- etc.) and the common ALTER TABLE / DROP CONSTRAINT / AlterEnum blocks are
-- already handled by 20260818195000 which runs before this migration.

-- AlterTable (unique to this migration — not in 20260818195000)
ALTER TABLE "CustomsFiling" ADD COLUMN "messageName" TEXT;

-- AlterTable
ALTER TABLE "FilingSnapshot" ADD COLUMN "hasSection301" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "section301List" TEXT;

-- AlterTable
ALTER TABLE "HtsDutyRate" ADD COLUMN "exclusion" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RegulatoryUpdate" ADD COLUMN "documentNumber" TEXT,
ADD COLUMN "metadata" JSONB;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "countryOfOrigin" TEXT,
ADD COLUMN "masterShipmentId" TEXT,
ADD COLUMN "scenarioId" TEXT;

-- AlterTable
ALTER TABLE "ShipmentDocument" ADD COLUMN "displayOrder" INTEGER;

-- CreateTable
CREATE TABLE "AdcvdOrder" (
    "id" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "petitioner" TEXT,
    "respondentCountries" TEXT[],
    "htsCodesInScope" TEXT[],
    "scopeLanguage" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "suspensionAgreement" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdcvdOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingUIConfig" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "procedureCode" TEXT NOT NULL,
    "messageName" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL DEFAULT 'import',
    "configData" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "FilingUIConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingMasterDataSource" (
    "id" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "tableName" TEXT,
    "valueField" TEXT,
    "labelField" TEXT,
    "staticOptions" JSONB,
    "apiEndpoint" TEXT,
    "apiMethod" TEXT NOT NULL DEFAULT 'GET',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "FilingMasterDataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkMetricSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "cyclTimeMedianHours" DOUBLE PRECISION,
    "firstPassRate" DOUBLE PRECISION,
    "exceptionAgeAvgHours" DOUBLE PRECISION,
    "touchRate" DOUBLE PRECISION,
    "dutyPerEntry" DECIMAL(65,30),
    "openExceptions" INTEGER NOT NULL,
    "filedEntries" INTEGER NOT NULL,
    "pscCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlEvidence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawbackLot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "lineItemId" TEXT,
    "htsCode" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "availableQty" DECIMAL(18,6) NOT NULL,
    "reservedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "claimedQty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitPurchasePrice" DECIMAL(18,6) NOT NULL,
    "dutyPaidPerUnit" DECIMAL(18,6) NOT NULL,
    "importDate" TIMESTAMP(3) NOT NULL,
    "exportDeadline" TIMESTAMP(3) NOT NULL,
    "hasSection301" BOOLEAN NOT NULL DEFAULT false,
    "section301List" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawbackLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawbackClaimSequence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "nextVal" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DrawbackClaimSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HtsPgaRequirement" (
    "id" TEXT NOT NULL,
    "htsNumber" TEXT NOT NULL,
    "agencyCode" TEXT NOT NULL,
    "programCode" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "formCodes" TEXT[],
    "guidanceText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HtsPgaRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEventDefinition" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "BillingEventCategory" NOT NULL,
    "defaultUnit" TEXT NOT NULL DEFAULT 'count',
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEventDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientId" TEXT,
    "importerId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "RateCardStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardVersion" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3),
    "status" "RateCardStatus" NOT NULL DEFAULT 'DRAFT',
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateCardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateRule" (
    "id" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "lineItemName" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "pricingModel" "PricingModel" NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "rate" DECIMAL(16,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "minCharge" DECIMAL(16,4),
    "maxCharge" DECIMAL(16,4),
    "includedQuantity" INTEGER NOT NULL DEFAULT 0,
    "tieredConfig" JSONB,
    "conditions" JSONB,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateRuleCapabilityMapping" (
    "id" TEXT NOT NULL,
    "rateRuleId" TEXT NOT NULL,
    "eventDefId" TEXT NOT NULL,

    CONSTRAINT "RateRuleCapabilityMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "loadedLaborRate" DECIMAL(16,4) NOT NULL,
    "aiTokenRate" DECIMAL(16,6) NOT NULL,
    "ocrPageRate" DECIMAL(16,4) NOT NULL,
    "aceTransmissionFee" DECIMAL(16,4) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "importerId" TEXT,
    "shipmentId" TEXT,
    "userId" TEXT,
    "agentId" TEXT,
    "quantity" DECIMAL(16,4) NOT NULL DEFAULT 1.0000,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "sourceFunction" TEXT NOT NULL,
    "sourceApi" TEXT,
    "sourceAgent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "automated" BOOLEAN NOT NULL DEFAULT true,
    "processingDuration" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentCharge" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "usageEventId" TEXT,
    "rateCardVersionId" TEXT,
    "rateRuleId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "unitPrice" DECIMAL(16,4) NOT NULL,
    "grossAmount" DECIMAL(16,4) NOT NULL,
    "discountAmount" DECIMAL(16,4) NOT NULL DEFAULT 0.0000,
    "netAmount" DECIMAL(16,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ChargeStatus" NOT NULL DEFAULT 'RATED',
    "invoiceLineId" TEXT,
    "calculationTrace" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentCost" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "usageEventId" TEXT,
    "costType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(16,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "userId" TEXT,
    "agentId" TEXT,
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeAdjustment" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "originalAmount" DECIMAL(16,4) NOT NULL,
    "adjustmentAmount" DECIMAL(16,4) NOT NULL,
    "newAmount" DECIMAL(16,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "importerId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(16,4) NOT NULL,
    "totalDiscounts" DECIMAL(16,4) NOT NULL DEFAULT 0.0000,
    "totalTax" DECIMAL(16,4) NOT NULL DEFAULT 0.0000,
    "totalAmount" DECIMAL(16,4) NOT NULL,
    "paidAmount" DECIMAL(16,4) NOT NULL DEFAULT 0.0000,
    "balanceDue" DECIMAL(16,4) NOT NULL,
    "notes" TEXT,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "unitPrice" DECIMAL(16,4) NOT NULL,
    "amount" DECIMAL(16,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(16,4) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "referenceNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingException" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "shipmentId" TEXT,
    "clientId" TEXT,
    "usageEventId" TEXT,
    "assignedToId" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "BillingException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMemory" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "AccountMemoryType" NOT NULL,
    "subjectType" "AccountMemorySubjectType" NOT NULL,
    "subjectId" TEXT,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "sourceType" "AccountMemorySourceType" NOT NULL,
    "sourceId" TEXT,
    "supersedesMemoryId" TEXT,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "searchVector" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEvidence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "sourceType" "AccountMemorySourceType" NOT NULL,
    "sourceId" TEXT,
    "excerpt" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdcvdOrder_caseNumber_key" ON "AdcvdOrder"("caseNumber");

-- CreateIndex
CREATE INDEX "AdcvdOrder_status_idx" ON "AdcvdOrder"("status");

-- CreateIndex
CREATE INDEX "FilingUIConfig_country_procedureCode_messageName_messageTyp_idx" ON "FilingUIConfig"("country", "procedureCode", "messageName", "messageType", "transactionType");

-- CreateIndex
CREATE INDEX "FilingUIConfig_isActive_idx" ON "FilingUIConfig"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FilingUIConfig_country_procedureCode_messageName_messageTyp_key" ON "FilingUIConfig"("country", "procedureCode", "messageName", "messageType", "transactionType");

-- CreateIndex
CREATE UNIQUE INDEX "FilingMasterDataSource_sourceName_key" ON "FilingMasterDataSource"("sourceName");

-- CreateIndex
CREATE INDEX "FilingMasterDataSource_sourceName_idx" ON "FilingMasterDataSource"("sourceName");

-- CreateIndex
CREATE INDEX "WorkMetricSnapshot_accountId_date_idx" ON "WorkMetricSnapshot"("accountId", "date");

-- CreateIndex
CREATE INDEX "ControlEvidence_accountId_idx" ON "ControlEvidence"("accountId");

-- CreateIndex
CREATE INDEX "DrawbackLot_accountId_htsCode_idx" ON "DrawbackLot"("accountId", "htsCode");

-- CreateIndex
CREATE INDEX "DrawbackLot_exportDeadline_idx" ON "DrawbackLot"("exportDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "DrawbackClaimSequence_accountId_key" ON "DrawbackClaimSequence"("accountId");

-- CreateIndex
CREATE INDEX "HtsPgaRequirement_htsNumber_idx" ON "HtsPgaRequirement"("htsNumber");

-- CreateIndex
CREATE INDEX "HtsPgaRequirement_agencyCode_idx" ON "HtsPgaRequirement"("agencyCode");

-- CreateIndex
CREATE UNIQUE INDEX "HtsPgaRequirement_htsNumber_agencyCode_key" ON "HtsPgaRequirement"("htsNumber", "agencyCode");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEventDefinition_eventCode_key" ON "BillingEventDefinition"("eventCode");

-- CreateIndex
CREATE INDEX "BillingEventDefinition_accountId_idx" ON "BillingEventDefinition"("accountId");

-- CreateIndex
CREATE INDEX "BillingEventDefinition_eventCode_idx" ON "BillingEventDefinition"("eventCode");

-- CreateIndex
CREATE INDEX "RateCard_accountId_idx" ON "RateCard"("accountId");

-- CreateIndex
CREATE INDEX "RateCard_clientId_idx" ON "RateCard"("clientId");

-- CreateIndex
CREATE INDEX "RateCard_importerId_idx" ON "RateCard"("importerId");

-- CreateIndex
CREATE INDEX "RateCardVersion_rateCardId_idx" ON "RateCardVersion"("rateCardId");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardVersion_rateCardId_version_key" ON "RateCardVersion"("rateCardId", "version");

-- CreateIndex
CREATE INDEX "RateRule_rateCardVersionId_idx" ON "RateRule"("rateCardVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "RateRuleCapabilityMapping_rateRuleId_eventDefId_key" ON "RateRuleCapabilityMapping"("rateRuleId", "eventDefId");

-- CreateIndex
CREATE INDEX "CostProfile_accountId_idx" ON "CostProfile"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_idempotencyKey_key" ON "UsageEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageEvent_accountId_idx" ON "UsageEvent"("accountId");

-- CreateIndex
CREATE INDEX "UsageEvent_shipmentId_idx" ON "UsageEvent"("shipmentId");

-- CreateIndex
CREATE INDEX "UsageEvent_clientId_idx" ON "UsageEvent"("clientId");

-- CreateIndex
CREATE INDEX "UsageEvent_occurredAt_idx" ON "UsageEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "UsageEvent_eventCode_idx" ON "UsageEvent"("eventCode");

-- CreateIndex
CREATE INDEX "ShipmentCharge_accountId_idx" ON "ShipmentCharge"("accountId");

-- CreateIndex
CREATE INDEX "ShipmentCharge_shipmentId_idx" ON "ShipmentCharge"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentCharge_status_idx" ON "ShipmentCharge"("status");

-- CreateIndex
CREATE INDEX "ShipmentCost_accountId_idx" ON "ShipmentCost"("accountId");

-- CreateIndex
CREATE INDEX "ShipmentCost_shipmentId_idx" ON "ShipmentCost"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentCost_costType_idx" ON "ShipmentCost"("costType");

-- CreateIndex
CREATE INDEX "ChargeAdjustment_chargeId_idx" ON "ChargeAdjustment"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_accountId_idx" ON "Invoice"("accountId");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_shipmentId_idx" ON "InvoiceLine"("shipmentId");

-- CreateIndex
CREATE INDEX "Payment_accountId_idx" ON "Payment"("accountId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "BillingException_accountId_idx" ON "BillingException"("accountId");

-- CreateIndex
CREATE INDEX "BillingException_status_idx" ON "BillingException"("status");

-- CreateIndex
CREATE INDEX "BillingException_type_idx" ON "BillingException"("type");

-- CreateIndex
CREATE INDEX "AccountMemory_accountId_idx" ON "AccountMemory"("accountId");

-- CreateIndex
CREATE INDEX "AccountMemory_accountId_type_idx" ON "AccountMemory"("accountId", "type");

-- CreateIndex
CREATE INDEX "AccountMemory_accountId_subjectType_subjectId_idx" ON "AccountMemory"("accountId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AccountMemory_supersedesMemoryId_idx" ON "AccountMemory"("supersedesMemoryId");

-- CreateIndex
CREATE INDEX "MemoryEvidence_accountId_idx" ON "MemoryEvidence"("accountId");

-- CreateIndex
CREATE INDEX "MemoryEvidence_memoryId_idx" ON "MemoryEvidence"("memoryId");

-- CreateIndex
CREATE INDEX "AuditLog_source_idx" ON "AuditLog"("source");

-- CreateIndex
CREATE INDEX "HtsDutyRate_rateType_idx" ON "HtsDutyRate"("rateType");

-- CreateIndex
CREATE INDEX "HtsDutyRate_caseNumber_idx" ON "HtsDutyRate"("caseNumber");

-- CreateIndex
CREATE INDEX "ImporterOfRecord_clientId_idx" ON "ImporterOfRecord"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryUpdate_documentNumber_key" ON "RegulatoryUpdate"("documentNumber");

-- CreateIndex
CREATE INDEX "Shipment_masterShipmentId_idx" ON "Shipment"("masterShipmentId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "LandedCostScenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_masterShipmentId_fkey" FOREIGN KEY ("masterShipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PscAttachment" ADD CONSTRAINT "PscAttachment_pscId_fkey" FOREIGN KEY ("pscId") REFERENCES "PostSummaryCorrection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protest" ADD CONSTRAINT "Protest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protest" ADD CONSTRAINT "Protest_linkedPscId_fkey" FOREIGN KEY ("linkedPscId") REFERENCES "PostSummaryCorrection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtestEntry" ADD CONSTRAINT "ProtestEntry_protestId_fkey" FOREIGN KEY ("protestId") REFERENCES "Protest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtestEntry" ADD CONSTRAINT "ProtestEntry_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtestAttachment" ADD CONSTRAINT "ProtestAttachment_protestId_fkey" FOREIGN KEY ("protestId") REFERENCES "Protest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtestNote" ADD CONSTRAINT "ProtestNote_protestId_fkey" FOREIGN KEY ("protestId") REFERENCES "Protest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkMetricSnapshot" ADD CONSTRAINT "WorkMetricSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlEvidence" ADD CONSTRAINT "ControlEvidence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawbackLot" ADD CONSTRAINT "DrawbackLot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawbackClaimSequence" ADD CONSTRAINT "DrawbackClaimSequence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEventDefinition" ADD CONSTRAINT "BillingEventDefinition_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "ImporterOfRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardVersion" ADD CONSTRAINT "RateCardVersion_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateRule" ADD CONSTRAINT "RateRule_rateCardVersionId_fkey" FOREIGN KEY ("rateCardVersionId") REFERENCES "RateCardVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateRuleCapabilityMapping" ADD CONSTRAINT "RateRuleCapabilityMapping_rateRuleId_fkey" FOREIGN KEY ("rateRuleId") REFERENCES "RateRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateRuleCapabilityMapping" ADD CONSTRAINT "RateRuleCapabilityMapping_eventDefId_fkey" FOREIGN KEY ("eventDefId") REFERENCES "BillingEventDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostProfile" ADD CONSTRAINT "CostProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_eventCode_fkey" FOREIGN KEY ("eventCode") REFERENCES "BillingEventDefinition"("eventCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCharge" ADD CONSTRAINT "ShipmentCharge_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCharge" ADD CONSTRAINT "ShipmentCharge_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCharge" ADD CONSTRAINT "ShipmentCharge_usageEventId_fkey" FOREIGN KEY ("usageEventId") REFERENCES "UsageEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCharge" ADD CONSTRAINT "ShipmentCharge_rateCardVersionId_fkey" FOREIGN KEY ("rateCardVersionId") REFERENCES "RateCardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCharge" ADD CONSTRAINT "ShipmentCharge_rateRuleId_fkey" FOREIGN KEY ("rateRuleId") REFERENCES "RateRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCharge" ADD CONSTRAINT "ShipmentCharge_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCost" ADD CONSTRAINT "ShipmentCost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCost" ADD CONSTRAINT "ShipmentCost_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentCost" ADD CONSTRAINT "ShipmentCost_usageEventId_fkey" FOREIGN KEY ("usageEventId") REFERENCES "UsageEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeAdjustment" ADD CONSTRAINT "ChargeAdjustment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "ShipmentCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "ImporterOfRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingException" ADD CONSTRAINT "BillingException_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingException" ADD CONSTRAINT "BillingException_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingException" ADD CONSTRAINT "BillingException_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMemory" ADD CONSTRAINT "AccountMemory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMemory" ADD CONSTRAINT "AccountMemory_supersedesMemoryId_fkey" FOREIGN KEY ("supersedesMemoryId") REFERENCES "AccountMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEvidence" ADD CONSTRAINT "MemoryEvidence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEvidence" ADD CONSTRAINT "MemoryEvidence_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "AccountMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "FilingActionConfiguration_country_procedureCode_messageName_s_k" RENAME TO "FilingActionConfiguration_country_procedureCode_messageName_key";

-- RenameIndex
ALTER INDEX "WtoTariffRate_reporterIso2_partnerIso2_hsCode6_tariffYear_rateT" RENAME TO "WtoTariffRate_reporterIso2_partnerIso2_hsCode6_tariffYear_r_key";
