-- Generated from Prisma 6.19.3 migrate diff after applying the full migration history.
-- Creates model families that existed in prisma/schema.prisma without migration DDL.

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

CREATE TABLE "DrawbackClaimSequence" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "nextVal" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "DrawbackClaimSequence_pkey" PRIMARY KEY ("id")
);

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

CREATE TABLE "RateRuleCapabilityMapping" (
    "id" TEXT NOT NULL,
    "rateRuleId" TEXT NOT NULL,
    "eventDefId" TEXT NOT NULL,
    CONSTRAINT "RateRuleCapabilityMapping_pkey" PRIMARY KEY ("id")
);

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

CREATE UNIQUE INDEX "AdcvdOrder_caseNumber_key" ON "AdcvdOrder"("caseNumber");
CREATE INDEX "AdcvdOrder_status_idx" ON "AdcvdOrder"("status");
CREATE INDEX "FilingUIConfig_country_procedureCode_messageName_messageTyp_idx" ON "FilingUIConfig"("country", "procedureCode", "messageName", "messageType", "transactionType");
CREATE INDEX "FilingUIConfig_isActive_idx" ON "FilingUIConfig"("isActive");
