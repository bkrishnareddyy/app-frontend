-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ownerUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "brokerLicenseNumber" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformUserRole" (
    "userId" TEXT NOT NULL,
    "platformRoleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformUserRole_pkey" PRIMARY KEY ("userId","platformRoleId")
);

-- CreateTable
CREATE TABLE "AccountMembership" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentNumber" TEXT NOT NULL,
    "importerName" TEXT NOT NULL,
    "importerOfRecordId" TEXT,
    "assignedBrokerId" TEXT,
    "poReference" TEXT,
    "entryType" TEXT NOT NULL DEFAULT 'Consumption Entry',
    "incoterm" TEXT NOT NULL DEFAULT 'CIF Los Angeles',
    "portOfEntry" TEXT DEFAULT 'Port of Los Angeles (2704)',
    "carrierName" TEXT DEFAULT 'Maersk Line',
    "countryOfExport" TEXT DEFAULT 'Germany',
    "estimatedArrival" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'In Progress',
    "healthStatus" TEXT NOT NULL DEFAULT 'Healthy',
    "readinessScore" INTEGER NOT NULL DEFAULT 87,
    "riskScore" INTEGER NOT NULL DEFAULT 28,
    "ownerName" TEXT NOT NULL DEFAULT 'Stephen',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentDocument" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 2,
    "fileUrl" TEXT,
    "checksum" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "confidence" INTEGER NOT NULL DEFAULT 95,
    "status" TEXT NOT NULL DEFAULT 'Received',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLineItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "partNumber" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "totalValue" DECIMAL(65,30) NOT NULL,
    "countryOfOrigin" TEXT NOT NULL,
    "htsCode" TEXT NOT NULL,
    "htsConfidence" INTEGER NOT NULL DEFAULT 97,
    "eccnCode" TEXT DEFAULT 'EAR99',
    "status" TEXT NOT NULL DEFAULT 'Valid',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentIcon" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Review Required',
    "confidence" INTEGER NOT NULL DEFAULT 76,
    "decisionSummary" TEXT NOT NULL,
    "purpose" TEXT,
    "dataSources" TEXT[],
    "regulations" TEXT[],
    "modelVersion" TEXT DEFAULT 'Qubere-Taxo-v2.3',
    "currentHtsCode" TEXT,
    "proposedHtsCode" TEXT,
    "proposedDescription" TEXT,
    "rulesApplied" TEXT[],
    "evidenceItems" JSONB,
    "humanNotes" TEXT,
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsFiling" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "importerOfRecordId" TEXT,
    "bondId" TEXT,
    "entryNumber" TEXT NOT NULL,
    "authority" TEXT NOT NULL DEFAULT 'US Customs (CBP)',
    "entryType" TEXT NOT NULL DEFAULT 'Consumption Entry',
    "filingType" TEXT NOT NULL DEFAULT 'ABI - Automated',
    "filingStatus" TEXT NOT NULL DEFAULT 'Filed',
    "paymentStatus" TEXT NOT NULL DEFAULT 'Paid',
    "totalValue" DECIMAL(65,30) NOT NULL DEFAULT 17750.00,
    "totalDuties" DECIMAL(65,30) NOT NULL DEFAULT 2850.00,
    "totalTaxes" DECIMAL(65,30) NOT NULL DEFAULT 13100.00,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 16250.00,
    "dutyBreakdown" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomsFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomsResponse" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Accepted',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomsResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryUpdate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "impactLevel" TEXT NOT NULL DEFAULT 'High',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "affectedShipmentsCount" INTEGER NOT NULL DEFAULT 27,
    "publishedText" TEXT NOT NULL DEFAULT '2h ago',
    "status" TEXT NOT NULL DEFAULT 'Immediate Action Required',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HTSCode" (
    "id" TEXT NOT NULL,
    "htsCode10" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chapterNumber" TEXT NOT NULL,
    "headingNumber" TEXT NOT NULL,
    "subheadingNumber" TEXT NOT NULL,
    "unitOfQuantity" TEXT DEFAULT 'PCS',
    "generalDutyRate" TEXT NOT NULL DEFAULT 'Free',
    "specialRatePrograms" JSONB,
    "column2DutyRate" TEXT DEFAULT '35%',
    "section301Applicable" BOOLEAN NOT NULL DEFAULT false,
    "section301AdditionalRate" DECIMAL(65,30) DEFAULT 0.0,
    "section232Applicable" BOOLEAN NOT NULL DEFAULT false,
    "section232AdditionalRate" DECIMAL(65,30) DEFAULT 0.0,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expirationDate" TIMESTAMP(3),
    "sourceRevision" TEXT NOT NULL DEFAULT 'HTSUS 2026 Rev 1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HTSCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeAgreement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginDetermination" (
    "id" TEXT NOT NULL,
    "shipmentLineItemId" TEXT NOT NULL,
    "tradeAgreementId" TEXT NOT NULL,
    "qualifies" BOOLEAN NOT NULL DEFAULT true,
    "criterion" TEXT NOT NULL DEFAULT 'Criterion A (Wholly Obtained)',
    "regionalValueContentPct" DECIMAL(65,30) DEFAULT 65.0,
    "calculationMethod" TEXT NOT NULL DEFAULT 'net cost',
    "agentDecisionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OriginDetermination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandedCostScenario" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originCountry" TEXT NOT NULL DEFAULT 'China',
    "destinationPort" TEXT NOT NULL DEFAULT 'Port of Long Beach (2709)',
    "incoterm" TEXT NOT NULL DEFAULT 'CIF',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandedCostScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandedCostScenarioLineItem" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "htsCodeId" TEXT NOT NULL,
    "unitValue" DECIMAL(65,30) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "freightCost" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "insuranceCost" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "dutyRateOverride" DECIMAL(65,30),
    "computedDuty" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "computedFees" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "computedLandedCost" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandedCostScenarioLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundOpportunity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "opportunityType" TEXT NOT NULL,
    "estimatedRefundAmount" DECIMAL(65,30) NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 92,
    "basis" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Identified',
    "identifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostSummaryCorrection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "originalFilingId" TEXT NOT NULL,
    "refundOpportunityId" TEXT,
    "reason" TEXT NOT NULL,
    "correctionType" TEXT NOT NULL DEFAULT 'classification',
    "originalDutyAmount" DECIMAL(65,30) NOT NULL,
    "correctedDutyAmount" DECIMAL(65,30) NOT NULL,
    "refundAmount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "cbpResponseCode" TEXT DEFAULT 'PSC_ACK',
    "filedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostSummaryCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportShipment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "exportShipmentNumber" TEXT NOT NULL,
    "exporterName" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "exportDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Exported',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportDocument" (
    "id" TEXT NOT NULL,
    "exportShipmentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Verified',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportLineItem" (
    "id" TEXT NOT NULL,
    "exportShipmentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partNumber" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "htsCode" TEXT NOT NULL,
    "unitValue" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawbackClaim" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "claimType" TEXT NOT NULL DEFAULT 'unused_merchandise',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "totalRefundClaimed" DECIMAL(65,30) NOT NULL,
    "cbpClaimNumber" TEXT DEFAULT 'DBK-2026-9901',
    "version" INTEGER NOT NULL DEFAULT 1,
    "filedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrawbackClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawbackMatch" (
    "id" TEXT NOT NULL,
    "drawbackClaimId" TEXT NOT NULL,
    "shipmentLineItemId" TEXT NOT NULL,
    "exportLineItemId" TEXT NOT NULL,
    "matchedQuantity" INTEGER NOT NULL,
    "matchMethod" TEXT NOT NULL DEFAULT 'FIFO',
    "dutyAttributed" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawbackMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAuditRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "auditType" TEXT NOT NULL DEFAULT 'reasonable_care_checklist',
    "overallResult" TEXT NOT NULL DEFAULT 'Pass',
    "checklistItems" JSONB NOT NULL,
    "riskScore" INTEGER NOT NULL DEFAULT 15,
    "runByAgentName" TEXT NOT NULL DEFAULT 'Qubere Audit Agent',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAuditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImporterOfRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "irsEin" TEXT NOT NULL,
    "cbpImporterNumber" TEXT NOT NULL,
    "address" JSONB NOT NULL,
    "bondId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImporterOfRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bond" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bondType" TEXT NOT NULL DEFAULT 'continuous',
    "suretyName" TEXT NOT NULL DEFAULT 'Roanoke Insurance Group',
    "bondNumber" TEXT NOT NULL,
    "bondAmount" DECIMAL(65,30) NOT NULL DEFAULT 50000.0,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expirationDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bond_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerOfAttorney" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "importerOfRecordId" TEXT NOT NULL,
    "grantedByEntity" TEXT NOT NULL,
    "signedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expirationDate" TIMESTAMP(3),
    "documentUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PowerOfAttorney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionItem" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "filingId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'Medium',
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "assignedToUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ExceptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryUpdateImpact" (
    "id" TEXT NOT NULL,
    "regulatoryUpdateId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "impactDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryUpdateImpact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionField" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 95,
    "pageNumber" INTEGER NOT NULL DEFAULT 1,
    "bbox" JSONB,
    "source" TEXT NOT NULL DEFAULT 'OCR_AI_AGENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationIssue" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'Warning',
    "field" TEXT NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "actualValue" TEXT NOT NULL,
    "sourceDocuments" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalProduct" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "sku" TEXT,
    "partNumber" TEXT,
    "manufacturer" TEXT,
    "countryOfOrigin" TEXT,
    "htsCode" TEXT,
    "dutyRate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "aliasName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'Invoice',
    "matchConfidence" INTEGER NOT NULL DEFAULT 94,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgaRequirement" (
    "id" TEXT NOT NULL,
    "shipmentLineItemId" TEXT NOT NULL,
    "agency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requiredFiling" TEXT NOT NULL,
    "missingPermits" TEXT[],
    "holdRisk" TEXT NOT NULL DEFAULT 'Medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PgaRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceFinding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'Warning',
    "description" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "confidence" INTEGER NOT NULL DEFAULT 92,
    "assignedToUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierRiskScore" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierId" TEXT,
    "score" INTEGER NOT NULL DEFAULT 15,
    "riskLevel" TEXT NOT NULL DEFAULT 'Low',
    "violationHistoryCount" INTEGER NOT NULL DEFAULT 0,
    "missingDocsCount" INTEGER NOT NULL DEFAULT 0,
    "pgaIssuesCount" INTEGER NOT NULL DEFAULT 0,
    "classificationIssuesCount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierRiskScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrokerMetrics" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "brokerName" TEXT NOT NULL,
    "entriesProcessed" INTEGER NOT NULL DEFAULT 142,
    "accuracyPct" DECIMAL(65,30) NOT NULL DEFAULT 98.5,
    "overrideRatePct" DECIMAL(65,30) NOT NULL DEFAULT 2.1,
    "correctionRatePct" DECIMAL(65,30) NOT NULL DEFAULT 0.7,
    "avgReviewTimeMin" INTEGER NOT NULL DEFAULT 18,
    "rejectedCount" INTEGER NOT NULL DEFAULT 1,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationAssistsRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "declaredValue" DECIMAL(65,30) NOT NULL,
    "transferPricingMatch" BOOLEAN NOT NULL DEFAULT true,
    "freightIncluded" BOOLEAN NOT NULL DEFAULT true,
    "insuranceIncluded" BOOLEAN NOT NULL DEFAULT true,
    "potentialAssists" JSONB,
    "relatedPartyTransaction" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Verified',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationAssistsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTimeline" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'System Audit Agent',
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeniedPartyWatchlist" (
    "id" TEXT NOT NULL,
    "listSource" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "program" TEXT,
    "addresses" JSONB,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeniedPartyWatchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "matchStatus" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "matchedParty" TEXT,
    "listSource" TEXT,
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbargoRule" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "restriction" TEXT NOT NULL,
    "authority" TEXT NOT NULL DEFAULT 'US OFAC / CBP UFLPA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbargoRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeBenchmark" (
    "id" TEXT NOT NULL,
    "htsCode10" TEXT NOT NULL,
    "industryAvgDuty" DECIMAL(65,30) NOT NULL DEFAULT 3.5,
    "avgDeclaredPrice" DECIMAL(65,30) NOT NULL,
    "topOriginCountry" TEXT NOT NULL DEFAULT 'China',
    "totalUSVolumeVal" DECIMAL(65,30) NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecutionLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" JSONB,
    "aiProviderUsed" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "inputSnapshot" JSONB,
    "outputSnapshot" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentStateRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "lifecycleStatus" TEXT NOT NULL,
    "userActionStatus" TEXT NOT NULL,
    "completenessScore" INTEGER NOT NULL DEFAULT 0,
    "complianceStatus" TEXT NOT NULL,
    "readinessScore" INTEGER NOT NULL DEFAULT 0,
    "blockersCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentStateRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_slug_key" ON "Account"("slug");

-- CreateIndex
CREATE INDEX "Account_type_idx" ON "Account"("type");

-- CreateIndex
CREATE INDEX "Account_slug_idx" ON "Account"("slug");

-- CreateIndex
CREATE INDEX "Account_ownerUserId_idx" ON "Account"("ownerUserId");

-- CreateIndex
CREATE INDEX "Account_deletedAt_idx" ON "Account"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_clerkUserId_idx" ON "User"("clerkUserId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformRole_name_key" ON "PlatformRole"("name");

-- CreateIndex
CREATE INDEX "AccountMembership_userId_idx" ON "AccountMembership"("userId");

-- CreateIndex
CREATE INDEX "AccountMembership_accountId_idx" ON "AccountMembership"("accountId");

-- CreateIndex
CREATE INDEX "AccountMembership_deletedAt_idx" ON "AccountMembership"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMembership_accountId_userId_key" ON "AccountMembership"("accountId", "userId");

-- CreateIndex
CREATE INDEX "Role_accountId_idx" ON "Role"("accountId");

-- CreateIndex
CREATE INDEX "Role_isSystem_idx" ON "Role"("isSystem");

-- CreateIndex
CREATE UNIQUE INDEX "Role_accountId_name_key" ON "Role"("accountId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_accountId_idx" ON "Invitation"("accountId");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "Invitation_token_idx" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_createdByUserId_idx" ON "Invitation"("createdByUserId");

-- CreateIndex
CREATE INDEX "AuditLog_accountId_idx" ON "AuditLog"("accountId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_success_idx" ON "AuditLog"("success");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_accountId_idx" ON "IdempotencyRecord"("accountId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_accountId_idempotencyKey_key" ON "IdempotencyRecord"("accountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Shipment_accountId_idx" ON "Shipment"("accountId");

-- CreateIndex
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");

-- CreateIndex
CREATE INDEX "Shipment_deletedAt_idx" ON "Shipment"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_accountId_shipmentNumber_key" ON "Shipment"("accountId", "shipmentNumber");

-- CreateIndex
CREATE INDEX "ShipmentDocument_shipmentId_idx" ON "ShipmentDocument"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentDocument_accountId_idx" ON "ShipmentDocument"("accountId");

-- CreateIndex
CREATE INDEX "ShipmentLineItem_shipmentId_idx" ON "ShipmentLineItem"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentLineItem_accountId_idx" ON "ShipmentLineItem"("accountId");

-- CreateIndex
CREATE INDEX "AgentDecision_shipmentId_idx" ON "AgentDecision"("shipmentId");

-- CreateIndex
CREATE INDEX "AgentDecision_accountId_idx" ON "AgentDecision"("accountId");

-- CreateIndex
CREATE INDEX "AgentDecision_status_idx" ON "AgentDecision"("status");

-- CreateIndex
CREATE INDEX "CustomsFiling_shipmentId_idx" ON "CustomsFiling"("shipmentId");

-- CreateIndex
CREATE INDEX "CustomsFiling_accountId_idx" ON "CustomsFiling"("accountId");

-- CreateIndex
CREATE INDEX "CustomsFiling_filingStatus_idx" ON "CustomsFiling"("filingStatus");

-- CreateIndex
CREATE INDEX "CustomsResponse_filingId_idx" ON "CustomsResponse"("filingId");

-- CreateIndex
CREATE INDEX "CustomsResponse_accountId_idx" ON "CustomsResponse"("accountId");

-- CreateIndex
CREATE INDEX "RegulatoryUpdate_jurisdiction_idx" ON "RegulatoryUpdate"("jurisdiction");

-- CreateIndex
CREATE INDEX "RegulatoryUpdate_category_idx" ON "RegulatoryUpdate"("category");

-- CreateIndex
CREATE INDEX "RegulatoryUpdate_impactLevel_idx" ON "RegulatoryUpdate"("impactLevel");

-- CreateIndex
CREATE UNIQUE INDEX "HTSCode_htsCode10_key" ON "HTSCode"("htsCode10");

-- CreateIndex
CREATE INDEX "HTSCode_htsCode10_idx" ON "HTSCode"("htsCode10");

-- CreateIndex
CREATE INDEX "HTSCode_chapterNumber_idx" ON "HTSCode"("chapterNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAgreement_code_key" ON "TradeAgreement"("code");

-- CreateIndex
CREATE INDEX "OriginDetermination_shipmentLineItemId_idx" ON "OriginDetermination"("shipmentLineItemId");

-- CreateIndex
CREATE INDEX "OriginDetermination_tradeAgreementId_idx" ON "OriginDetermination"("tradeAgreementId");

-- CreateIndex
CREATE INDEX "LandedCostScenario_accountId_idx" ON "LandedCostScenario"("accountId");

-- CreateIndex
CREATE INDEX "LandedCostScenarioLineItem_scenarioId_idx" ON "LandedCostScenarioLineItem"("scenarioId");

-- CreateIndex
CREATE INDEX "LandedCostScenarioLineItem_htsCodeId_idx" ON "LandedCostScenarioLineItem"("htsCodeId");

-- CreateIndex
CREATE INDEX "RefundOpportunity_accountId_idx" ON "RefundOpportunity"("accountId");

-- CreateIndex
CREATE INDEX "RefundOpportunity_filingId_idx" ON "RefundOpportunity"("filingId");

-- CreateIndex
CREATE INDEX "PostSummaryCorrection_accountId_idx" ON "PostSummaryCorrection"("accountId");

-- CreateIndex
CREATE INDEX "PostSummaryCorrection_originalFilingId_idx" ON "PostSummaryCorrection"("originalFilingId");

-- CreateIndex
CREATE INDEX "ExportShipment_accountId_idx" ON "ExportShipment"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportShipment_accountId_exportShipmentNumber_key" ON "ExportShipment"("accountId", "exportShipmentNumber");

-- CreateIndex
CREATE INDEX "ExportDocument_exportShipmentId_idx" ON "ExportDocument"("exportShipmentId");

-- CreateIndex
CREATE INDEX "ExportDocument_accountId_idx" ON "ExportDocument"("accountId");

-- CreateIndex
CREATE INDEX "ExportLineItem_exportShipmentId_idx" ON "ExportLineItem"("exportShipmentId");

-- CreateIndex
CREATE INDEX "ExportLineItem_accountId_idx" ON "ExportLineItem"("accountId");

-- CreateIndex
CREATE INDEX "DrawbackClaim_accountId_idx" ON "DrawbackClaim"("accountId");

-- CreateIndex
CREATE INDEX "DrawbackMatch_drawbackClaimId_idx" ON "DrawbackMatch"("drawbackClaimId");

-- CreateIndex
CREATE INDEX "DrawbackMatch_shipmentLineItemId_idx" ON "DrawbackMatch"("shipmentLineItemId");

-- CreateIndex
CREATE INDEX "DrawbackMatch_exportLineItemId_idx" ON "DrawbackMatch"("exportLineItemId");

-- CreateIndex
CREATE INDEX "ComplianceAuditRecord_accountId_idx" ON "ComplianceAuditRecord"("accountId");

-- CreateIndex
CREATE INDEX "ComplianceAuditRecord_filingId_idx" ON "ComplianceAuditRecord"("filingId");

-- CreateIndex
CREATE UNIQUE INDEX "ImporterOfRecord_cbpImporterNumber_key" ON "ImporterOfRecord"("cbpImporterNumber");

-- CreateIndex
CREATE INDEX "ImporterOfRecord_accountId_idx" ON "ImporterOfRecord"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Bond_bondNumber_key" ON "Bond"("bondNumber");

-- CreateIndex
CREATE INDEX "Bond_accountId_idx" ON "Bond"("accountId");

-- CreateIndex
CREATE INDEX "PowerOfAttorney_accountId_idx" ON "PowerOfAttorney"("accountId");

-- CreateIndex
CREATE INDEX "PowerOfAttorney_importerOfRecordId_idx" ON "PowerOfAttorney"("importerOfRecordId");

-- CreateIndex
CREATE INDEX "ExceptionItem_accountId_idx" ON "ExceptionItem"("accountId");

-- CreateIndex
CREATE INDEX "ExceptionItem_status_idx" ON "ExceptionItem"("status");

-- CreateIndex
CREATE INDEX "RegulatoryUpdateImpact_regulatoryUpdateId_idx" ON "RegulatoryUpdateImpact"("regulatoryUpdateId");

-- CreateIndex
CREATE INDEX "RegulatoryUpdateImpact_shipmentId_idx" ON "RegulatoryUpdateImpact"("shipmentId");

-- CreateIndex
CREATE INDEX "ExtractionField_documentId_idx" ON "ExtractionField"("documentId");

-- CreateIndex
CREATE INDEX "ExtractionField_fieldName_idx" ON "ExtractionField"("fieldName");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_shipmentId_idx" ON "ReconciliationIssue"("shipmentId");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_accountId_idx" ON "ReconciliationIssue"("accountId");

-- CreateIndex
CREATE INDEX "CanonicalProduct_accountId_idx" ON "CanonicalProduct"("accountId");

-- CreateIndex
CREATE INDEX "ProductAlias_canonicalProductId_idx" ON "ProductAlias"("canonicalProductId");

-- CreateIndex
CREATE INDEX "PgaRequirement_shipmentLineItemId_idx" ON "PgaRequirement"("shipmentLineItemId");

-- CreateIndex
CREATE INDEX "ComplianceFinding_accountId_idx" ON "ComplianceFinding"("accountId");

-- CreateIndex
CREATE INDEX "ComplianceFinding_filingId_idx" ON "ComplianceFinding"("filingId");

-- CreateIndex
CREATE INDEX "ComplianceFinding_status_idx" ON "ComplianceFinding"("status");

-- CreateIndex
CREATE INDEX "SupplierRiskScore_accountId_idx" ON "SupplierRiskScore"("accountId");

-- CreateIndex
CREATE INDEX "SupplierRiskScore_supplierName_idx" ON "SupplierRiskScore"("supplierName");

-- CreateIndex
CREATE INDEX "BrokerMetrics_accountId_idx" ON "BrokerMetrics"("accountId");

-- CreateIndex
CREATE INDEX "BrokerMetrics_brokerName_idx" ON "BrokerMetrics"("brokerName");

-- CreateIndex
CREATE UNIQUE INDEX "ValuationAssistsRecord_filingId_key" ON "ValuationAssistsRecord"("filingId");

-- CreateIndex
CREATE INDEX "ValuationAssistsRecord_accountId_idx" ON "ValuationAssistsRecord"("accountId");

-- CreateIndex
CREATE INDEX "AuditTimeline_accountId_idx" ON "AuditTimeline"("accountId");

-- CreateIndex
CREATE INDEX "AuditTimeline_filingId_idx" ON "AuditTimeline"("filingId");

-- CreateIndex
CREATE INDEX "DeniedPartyWatchlist_entityName_idx" ON "DeniedPartyWatchlist"("entityName");

-- CreateIndex
CREATE INDEX "DeniedPartyWatchlist_listSource_idx" ON "DeniedPartyWatchlist"("listSource");

-- CreateIndex
CREATE INDEX "ScreeningLog_accountId_idx" ON "ScreeningLog"("accountId");

-- CreateIndex
CREATE INDEX "ScreeningLog_matchStatus_idx" ON "ScreeningLog"("matchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "EmbargoRule_countryCode_key" ON "EmbargoRule"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "TradeBenchmark_htsCode10_key" ON "TradeBenchmark"("htsCode10");

-- CreateIndex
CREATE INDEX "TradeBenchmark_htsCode10_idx" ON "TradeBenchmark"("htsCode10");

-- CreateIndex
CREATE INDEX "AgentExecutionLog_accountId_idx" ON "AgentExecutionLog"("accountId");

-- CreateIndex
CREATE INDEX "AgentExecutionLog_shipmentId_idx" ON "AgentExecutionLog"("shipmentId");

-- CreateIndex
CREATE INDEX "AgentExecutionLog_agentName_idx" ON "AgentExecutionLog"("agentName");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentStateRecord_shipmentId_key" ON "ShipmentStateRecord"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentStateRecord_accountId_idx" ON "ShipmentStateRecord"("accountId");

-- CreateIndex
CREATE INDEX "ShipmentStateRecord_shipmentId_idx" ON "ShipmentStateRecord"("shipmentId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformUserRole" ADD CONSTRAINT "PlatformUserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformUserRole" ADD CONSTRAINT "PlatformUserRole_platformRoleId_fkey" FOREIGN KEY ("platformRoleId") REFERENCES "PlatformRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_importerOfRecordId_fkey" FOREIGN KEY ("importerOfRecordId") REFERENCES "ImporterOfRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_assignedBrokerId_fkey" FOREIGN KEY ("assignedBrokerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLineItem" ADD CONSTRAINT "ShipmentLineItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLineItem" ADD CONSTRAINT "ShipmentLineItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsFiling" ADD CONSTRAINT "CustomsFiling_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsFiling" ADD CONSTRAINT "CustomsFiling_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsFiling" ADD CONSTRAINT "CustomsFiling_importerOfRecordId_fkey" FOREIGN KEY ("importerOfRecordId") REFERENCES "ImporterOfRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsFiling" ADD CONSTRAINT "CustomsFiling_bondId_fkey" FOREIGN KEY ("bondId") REFERENCES "Bond"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsResponse" ADD CONSTRAINT "CustomsResponse_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsResponse" ADD CONSTRAINT "CustomsResponse_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginDetermination" ADD CONSTRAINT "OriginDetermination_shipmentLineItemId_fkey" FOREIGN KEY ("shipmentLineItemId") REFERENCES "ShipmentLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginDetermination" ADD CONSTRAINT "OriginDetermination_tradeAgreementId_fkey" FOREIGN KEY ("tradeAgreementId") REFERENCES "TradeAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginDetermination" ADD CONSTRAINT "OriginDetermination_agentDecisionId_fkey" FOREIGN KEY ("agentDecisionId") REFERENCES "AgentDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandedCostScenario" ADD CONSTRAINT "LandedCostScenario_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandedCostScenario" ADD CONSTRAINT "LandedCostScenario_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandedCostScenarioLineItem" ADD CONSTRAINT "LandedCostScenarioLineItem_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "LandedCostScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandedCostScenarioLineItem" ADD CONSTRAINT "LandedCostScenarioLineItem_htsCodeId_fkey" FOREIGN KEY ("htsCodeId") REFERENCES "HTSCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOpportunity" ADD CONSTRAINT "RefundOpportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundOpportunity" ADD CONSTRAINT "RefundOpportunity_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSummaryCorrection" ADD CONSTRAINT "PostSummaryCorrection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSummaryCorrection" ADD CONSTRAINT "PostSummaryCorrection_originalFilingId_fkey" FOREIGN KEY ("originalFilingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSummaryCorrection" ADD CONSTRAINT "PostSummaryCorrection_refundOpportunityId_fkey" FOREIGN KEY ("refundOpportunityId") REFERENCES "RefundOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSummaryCorrection" ADD CONSTRAINT "PostSummaryCorrection_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportShipment" ADD CONSTRAINT "ExportShipment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportDocument" ADD CONSTRAINT "ExportDocument_exportShipmentId_fkey" FOREIGN KEY ("exportShipmentId") REFERENCES "ExportShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportDocument" ADD CONSTRAINT "ExportDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportLineItem" ADD CONSTRAINT "ExportLineItem_exportShipmentId_fkey" FOREIGN KEY ("exportShipmentId") REFERENCES "ExportShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportLineItem" ADD CONSTRAINT "ExportLineItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawbackClaim" ADD CONSTRAINT "DrawbackClaim_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawbackMatch" ADD CONSTRAINT "DrawbackMatch_drawbackClaimId_fkey" FOREIGN KEY ("drawbackClaimId") REFERENCES "DrawbackClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawbackMatch" ADD CONSTRAINT "DrawbackMatch_shipmentLineItemId_fkey" FOREIGN KEY ("shipmentLineItemId") REFERENCES "ShipmentLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawbackMatch" ADD CONSTRAINT "DrawbackMatch_exportLineItemId_fkey" FOREIGN KEY ("exportLineItemId") REFERENCES "ExportLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAuditRecord" ADD CONSTRAINT "ComplianceAuditRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAuditRecord" ADD CONSTRAINT "ComplianceAuditRecord_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImporterOfRecord" ADD CONSTRAINT "ImporterOfRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImporterOfRecord" ADD CONSTRAINT "ImporterOfRecord_bondId_fkey" FOREIGN KEY ("bondId") REFERENCES "Bond"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bond" ADD CONSTRAINT "Bond_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerOfAttorney" ADD CONSTRAINT "PowerOfAttorney_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PowerOfAttorney" ADD CONSTRAINT "PowerOfAttorney_importerOfRecordId_fkey" FOREIGN KEY ("importerOfRecordId") REFERENCES "ImporterOfRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionItem" ADD CONSTRAINT "ExceptionItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionItem" ADD CONSTRAINT "ExceptionItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionItem" ADD CONSTRAINT "ExceptionItem_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionItem" ADD CONSTRAINT "ExceptionItem_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryUpdateImpact" ADD CONSTRAINT "RegulatoryUpdateImpact_regulatoryUpdateId_fkey" FOREIGN KEY ("regulatoryUpdateId") REFERENCES "RegulatoryUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryUpdateImpact" ADD CONSTRAINT "RegulatoryUpdateImpact_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionField" ADD CONSTRAINT "ExtractionField_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ShipmentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalProduct" ADD CONSTRAINT "CanonicalProduct_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PgaRequirement" ADD CONSTRAINT "PgaRequirement_shipmentLineItemId_fkey" FOREIGN KEY ("shipmentLineItemId") REFERENCES "ShipmentLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceFinding" ADD CONSTRAINT "ComplianceFinding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceFinding" ADD CONSTRAINT "ComplianceFinding_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceFinding" ADD CONSTRAINT "ComplianceFinding_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRiskScore" ADD CONSTRAINT "SupplierRiskScore_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokerMetrics" ADD CONSTRAINT "BrokerMetrics_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationAssistsRecord" ADD CONSTRAINT "ValuationAssistsRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationAssistsRecord" ADD CONSTRAINT "ValuationAssistsRecord_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTimeline" ADD CONSTRAINT "AuditTimeline_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTimeline" ADD CONSTRAINT "AuditTimeline_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningLog" ADD CONSTRAINT "ScreeningLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecutionLog" ADD CONSTRAINT "AgentExecutionLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentStateRecord" ADD CONSTRAINT "ShipmentStateRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
