-- Out-of-band tables declared here so a fresh shadow database can build from migrations.
-- All statements are guarded (IF NOT EXISTS / DO $$ checks) so they are safe to re-run.

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountMembershipRole" (
    "accountMembershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountMembershipRole_pkey" PRIMARY KEY ("accountMembershipId","roleId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Client" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LegalEntity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "clientId" TEXT,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "entityType" TEXT NOT NULL DEFAULT 'US_CORPORATION',
    "country" TEXT NOT NULL DEFAULT 'US',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "stateProvince" TEXT,
    "postalCode" TEXT,
    "taxIdentifier" TEXT,
    "taxIdentifierType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CustomsProfile" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "cbpImporterNumber" TEXT,
    "importerNumberType" TEXT,
    "ein" TEXT,
    "einLast4" TEXT,
    "bondType" TEXT,
    "bondNumber" TEXT,
    "continuousBond" BOOLEAN NOT NULL DEFAULT false,
    "singleTransactionBond" BOOLEAN NOT NULL DEFAULT false,
    "customsBrokerOfRecord" TEXT,
    "powerOfAttorneyStatus" TEXT NOT NULL DEFAULT 'NOT_FILED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomsProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShipmentParty" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "confidence" DOUBLE PRECISION DEFAULT 1.0,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentParseVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parserVersion" TEXT NOT NULL DEFAULT '2.0.0',
    "modelVersion" TEXT NOT NULL DEFAULT 'gemini-3.6-flash',
    "rawJson" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT,
    "parserProvider" TEXT,
    "parserName" TEXT,
    "profile" TEXT,
    "reason" TEXT,
    "configHash" TEXT,
    "schemaVersion" TEXT,
    "externalTaskId" TEXT,
    "idempotencyKey" TEXT,
    "status" TEXT DEFAULT 'SUCCEEDED',
    "providerStatus" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "pollAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "durationMs" INTEGER,
    "pageCount" INTEGER,
    "ocrUsed" BOOLEAN,
    "fullPageOcrUsed" BOOLEAN,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryable" BOOLEAN,
    "warningsJson" JSONB,
    "qualityJson" JSONB,
    "artifactsJson" JSONB,
    "correlationId" TEXT,

    CONSTRAINT "DocumentParseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShipmentChangeEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "userId" TEXT,
    "changeType" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShipmentEventLog" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB,
    "triggeredBy" TEXT NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentExecutionRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "shipmentId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "triggerEvent" TEXT,
    "invokedBy" TEXT DEFAULT 'SYSTEM',
    "stepNumber" INTEGER,
    "nextStep" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "confidence" JSONB,
    "decisionId" TEXT,
    "aiProviderUsed" TEXT,
    "durationMs" INTEGER,
    "modelVersion" TEXT DEFAULT 'gemini-3.6-flash',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "inputSnapshot" JSONB,
    "outputSnapshot" JSONB,
    "runId" TEXT,

    CONSTRAINT "AgentExecutionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PipelineJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "totalSteps" INTEGER NOT NULL DEFAULT 10,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PipelineStepExecution" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "agentName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "output" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "PipelineStepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "HtsRelease" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "editionYear" INTEGER NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "releaseName" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "sourceUrl" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "rawObjectKey" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validationStatus" TEXT NOT NULL,
    "publicationStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "supersedesReleaseId" TEXT,

    CONSTRAINT "HtsRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "HtsNode" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "parentId" TEXT,
    "indentLevel" INTEGER NOT NULL,
    "htsNumberDisplay" TEXT NOT NULL,
    "htsNumberNormalized" TEXT NOT NULL,
    "codeLevel" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "fullDescription" TEXT NOT NULL,
    "isSuperiorHeading" BOOLEAN NOT NULL DEFAULT false,
    "isClassifiable" BOOLEAN NOT NULL DEFAULT true,
    "chapter" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "subheading6" TEXT,
    "tariffLine8" TEXT,
    "statisticalSuffix10" TEXT,

    CONSTRAINT "HtsNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "HtsDutyRate" (
    "id" TEXT NOT NULL,
    "htsNodeId" TEXT NOT NULL,
    "rateColumn" TEXT NOT NULL,
    "programCode" TEXT,
    "rawRateText" TEXT NOT NULL,
    "rateType" TEXT,
    "adValoremPercent" DOUBLE PRECISION,
    "specificAmount" DOUBLE PRECISION,
    "specificUnit" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "parseStatus" TEXT NOT NULL DEFAULT 'PARSED',

    CONSTRAINT "HtsDutyRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "HtsUnit" (
    "id" TEXT NOT NULL,
    "htsNodeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "unitCode" TEXT NOT NULL,

    CONSTRAINT "HtsUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LegalDocument" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "rawObjectKey" TEXT,
    "checksum" TEXT NOT NULL,
    "extractionStatus" TEXT NOT NULL DEFAULT 'COMPLETED',

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LegalFragment" (
    "id" TEXT NOT NULL,
    "legalDocumentId" TEXT NOT NULL,
    "citation" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "parentFragmentId" TEXT,
    "pageOrLocation" TEXT,

    CONSTRAINT "LegalFragment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "HtsNoteLink" (
    "htsNodeId" TEXT NOT NULL,
    "legalFragmentId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL DEFAULT 'APPLIES_TO',

    CONSTRAINT "HtsNoteLink_pkey" PRIMARY KEY ("htsNodeId","legalFragmentId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "HtsChange" (
    "id" TEXT NOT NULL,
    "fromReleaseId" TEXT NOT NULL,
    "toReleaseId" TEXT NOT NULL,
    "oldHtsNodeId" TEXT,
    "newHtsNodeId" TEXT,
    "changeType" TEXT NOT NULL,
    "changedFields" JSONB NOT NULL,
    "sourceActionUrl" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "HtsChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Ruling" (
    "id" TEXT NOT NULL,
    "rulingNumber" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL DEFAULT 'CBP_CROSS',
    "sourceUrl" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "office" TEXT,
    "rulingType" TEXT NOT NULL DEFAULT 'HQ',
    "title" TEXT NOT NULL,
    "rawObjectKey" TEXT,
    "checksum" TEXT,
    "publicationStatus" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "modifiedOrRevokedStatus" TEXT NOT NULL DEFAULT 'EFFECTIVE',
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ruling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RulingFragment" (
    "id" TEXT NOT NULL,
    "rulingId" TEXT NOT NULL,
    "fragmentType" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "citationLocation" TEXT,

    CONSTRAINT "RulingFragment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RulingHtsReference" (
    "rulingId" TEXT NOT NULL,
    "htsNumberDisplay" TEXT NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'CLASSIFIED_AS',

    CONSTRAINT "RulingHtsReference_pkey" PRIMARY KEY ("rulingId","htsNumberDisplay")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RulingRelationship" (
    "fromRulingId" TEXT NOT NULL,
    "toRulingId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "evidenceFragmentId" TEXT,

    CONSTRAINT "RulingRelationship_pkey" PRIMARY KEY ("fromRulingId","toRulingId","relationshipType")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClassificationCase" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assigneeUserId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'US',
    "classificationAsOfDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "htsReleaseId" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ClassificationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClassificationSubject" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "canonicalProductId" TEXT,
    "rawDescription" TEXT NOT NULL,
    "structuredAttributesJson" JSONB NOT NULL DEFAULT '{}',
    "countryOfOrigin" TEXT,
    "intendedUse" TEXT,
    "completenessScore" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ClassificationSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CaseDocument" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "detectedMimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "malwareStatus" TEXT NOT NULL DEFAULT 'PASSED',
    "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "retentionClass" TEXT NOT NULL DEFAULT 'STANDARD',

    CONSTRAINT "CaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExtractedFact" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT,
    "factType" TEXT NOT NULL,
    "normalizedValueJson" JSONB NOT NULL,
    "rawValue" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "page" INTEGER,
    "regionJson" JSONB,
    "modelVersion" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedByUserId" TEXT,

    CONSTRAINT "ExtractedFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClassificationRun" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "idempotencyKey" TEXT,
    "htsReleaseId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "modelProvider" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "rulesEngineVersion" TEXT NOT NULL,
    "retrievalIndexVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "tokenUsageJson" JSONB,
    "costAmount" DOUBLE PRECISION,
    "failureCode" TEXT,

    CONSTRAINT "ClassificationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClassificationProposal" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "proposedHtsNodeId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "calibratedConfidence" DOUBLE PRECISION NOT NULL,
    "confidenceBand" TEXT NOT NULL,
    "recommendationStatus" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "missingFactsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GriAnalysisStep" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "griRule" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "deterministicChecksJson" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "GriAnalysisStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProposalEvidence" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "sourceEntityId" TEXT,
    "sourceReleaseId" TEXT,
    "sourceUrl" TEXT,
    "citation" TEXT NOT NULL,
    "quotedFragment" TEXT NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL,
    "supportsOrConflicts" TEXT NOT NULL,

    CONSTRAINT "ProposalEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClassificationDecision" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "proposalId" TEXT,
    "decisionStatus" TEXT NOT NULL,
    "approvedHtsNodeId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "overrideReason" TEXT,
    "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "supersedesDecisionId" TEXT,

    CONSTRAINT "ClassificationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Fact" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "sourceType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "documentId" TEXT,
    "documentPage" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FilingSnapshot" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "snapshotData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FilingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountMembershipRole_roleId_idx" ON "AccountMembershipRole"("roleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Client_accountId_idx" ON "Client"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Client_accountId_status_idx" ON "Client"("accountId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LegalEntity_accountId_idx" ON "LegalEntity"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LegalEntity_clientId_idx" ON "LegalEntity"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LegalEntity_legalName_idx" ON "LegalEntity"("legalName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CustomsProfile_legalEntityId_idx" ON "CustomsProfile"("legalEntityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CustomsProfile_cbpImporterNumber_idx" ON "CustomsProfile"("cbpImporterNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShipmentParty_shipmentId_idx" ON "ShipmentParty"("shipmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShipmentParty_legalEntityId_idx" ON "ShipmentParty"("legalEntityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShipmentParty_shipmentId_role_idx" ON "ShipmentParty"("shipmentId", "role");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentParseVersion_idempotencyKey_key" ON "DocumentParseVersion"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_documentId_idx" ON "DocumentParseVersion"("documentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_documentId_version_idx" ON "DocumentParseVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_accountId_idx" ON "DocumentParseVersion"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_status_nextPollAt_idx" ON "DocumentParseVersion"("status", "nextPollAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_status_nextRetryAt_idx" ON "DocumentParseVersion"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentParseVersion_status_heartbeatAt_idx" ON "DocumentParseVersion"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShipmentChangeEvent_shipmentId_idx" ON "ShipmentChangeEvent"("shipmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShipmentChangeEvent_userId_idx" ON "ShipmentChangeEvent"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShipmentEventLog_shipmentId_idx" ON "ShipmentEventLog"("shipmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShipmentEventLog_eventType_idx" ON "ShipmentEventLog"("eventType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentExecutionRecord_shipmentId_idx" ON "AgentExecutionRecord"("shipmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentExecutionRecord_accountId_idx" ON "AgentExecutionRecord"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentExecutionRecord_agentName_idx" ON "AgentExecutionRecord"("agentName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentExecutionRecord_runId_idx" ON "AgentExecutionRecord"("runId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PipelineJob_status_priority_createdAt_idx" ON "PipelineJob"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PipelineJob_shipmentId_idx" ON "PipelineJob"("shipmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PipelineStepExecution_jobId_stepNumber_idx" ON "PipelineStepExecution"("jobId", "stepNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsRelease_publicationStatus_idx" ON "HtsRelease"("publicationStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsRelease_effectiveFrom_idx" ON "HtsRelease"("effectiveFrom");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsRelease_sha256_idx" ON "HtsRelease"("sha256");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsRelease_country_idx" ON "HtsRelease"("country");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsNode_releaseId_idx" ON "HtsNode"("releaseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsNode_htsNumberNormalized_idx" ON "HtsNode"("htsNumberNormalized");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsNode_chapter_heading_idx" ON "HtsNode"("chapter", "heading");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsNode_codeLevel_idx" ON "HtsNode"("codeLevel");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsDutyRate_htsNodeId_idx" ON "HtsDutyRate"("htsNodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsDutyRate_rateColumn_idx" ON "HtsDutyRate"("rateColumn");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsUnit_htsNodeId_idx" ON "HtsUnit"("htsNodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LegalDocument_releaseId_idx" ON "LegalDocument"("releaseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LegalDocument_documentType_idx" ON "LegalDocument"("documentType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LegalFragment_legalDocumentId_idx" ON "LegalFragment"("legalDocumentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LegalFragment_citation_idx" ON "LegalFragment"("citation");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "HtsChange_fromReleaseId_toReleaseId_idx" ON "HtsChange"("fromReleaseId", "toReleaseId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Ruling_rulingNumber_key" ON "Ruling"("rulingNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ruling_rulingNumber_idx" ON "Ruling"("rulingNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ruling_issuedAt_idx" ON "Ruling"("issuedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RulingFragment_rulingId_idx" ON "RulingFragment"("rulingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationCase_accountId_idx" ON "ClassificationCase"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationCase_status_idx" ON "ClassificationCase"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationCase_assigneeUserId_idx" ON "ClassificationCase"("assigneeUserId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationSubject_caseId_idx" ON "ClassificationSubject"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CaseDocument_caseId_idx" ON "CaseDocument"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CaseDocument_accountId_idx" ON "CaseDocument"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtractedFact_caseId_idx" ON "ExtractedFact"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtractedFact_factType_idx" ON "ExtractedFact"("factType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationRun_caseId_idx" ON "ClassificationRun"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationRun_status_idx" ON "ClassificationRun"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationProposal_runId_idx" ON "ClassificationProposal"("runId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationProposal_proposedHtsNodeId_idx" ON "ClassificationProposal"("proposedHtsNodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GriAnalysisStep_proposalId_sequence_idx" ON "GriAnalysisStep"("proposalId", "sequence");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProposalEvidence_proposalId_idx" ON "ProposalEvidence"("proposalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationDecision_caseId_idx" ON "ClassificationDecision"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClassificationDecision_approvedHtsNodeId_idx" ON "ClassificationDecision"("approvedHtsNodeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Fact_shipmentId_idx" ON "Fact"("shipmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Fact_field_idx" ON "Fact"("field");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FilingSnapshot_filingId_key" ON "FilingSnapshot"("filingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FilingSnapshot_filingId_idx" ON "FilingSnapshot"("filingId");

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountMembershipRole_accountMembershipId_fkey') THEN
        ALTER TABLE "AccountMembershipRole" ADD CONSTRAINT "AccountMembershipRole_accountMembershipId_fkey" FOREIGN KEY ("accountMembershipId") REFERENCES "AccountMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountMembershipRole_roleId_fkey') THEN
        ALTER TABLE "AccountMembershipRole" ADD CONSTRAINT "AccountMembershipRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Shipment_clientId_fkey') THEN
        ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LandedCostScenarioLineItem_htsCodeId_fkey') THEN
        ALTER TABLE "LandedCostScenarioLineItem" ADD CONSTRAINT "LandedCostScenarioLineItem_htsCodeId_fkey" FOREIGN KEY ("htsCodeId") REFERENCES "HtsNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImporterOfRecord_clientId_fkey') THEN
        ALTER TABLE "ImporterOfRecord" ADD CONSTRAINT "ImporterOfRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Client_accountId_fkey') THEN
        ALTER TABLE "Client" ADD CONSTRAINT "Client_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalEntity_accountId_fkey') THEN
        ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalEntity_clientId_fkey') THEN
        ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomsProfile_legalEntityId_fkey') THEN
        ALTER TABLE "CustomsProfile" ADD CONSTRAINT "CustomsProfile_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentParty_shipmentId_fkey') THEN
        ALTER TABLE "ShipmentParty" ADD CONSTRAINT "ShipmentParty_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentParty_legalEntityId_fkey') THEN
        ALTER TABLE "ShipmentParty" ADD CONSTRAINT "ShipmentParty_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentParseVersion_documentId_fkey') THEN
        ALTER TABLE "DocumentParseVersion" ADD CONSTRAINT "DocumentParseVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ShipmentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentParseVersion_accountId_fkey') THEN
        ALTER TABLE "DocumentParseVersion" ADD CONSTRAINT "DocumentParseVersion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentChangeEvent_shipmentId_fkey') THEN
        ALTER TABLE "ShipmentChangeEvent" ADD CONSTRAINT "ShipmentChangeEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentChangeEvent_userId_fkey') THEN
        ALTER TABLE "ShipmentChangeEvent" ADD CONSTRAINT "ShipmentChangeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentEventLog_shipmentId_fkey') THEN
        ALTER TABLE "ShipmentEventLog" ADD CONSTRAINT "ShipmentEventLog_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentExecutionRecord_accountId_fkey') THEN
        ALTER TABLE "AgentExecutionRecord" ADD CONSTRAINT "AgentExecutionRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgentExecutionRecord_shipmentId_fkey') THEN
        ALTER TABLE "AgentExecutionRecord" ADD CONSTRAINT "AgentExecutionRecord_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineJob_shipmentId_fkey') THEN
        ALTER TABLE "PipelineJob" ADD CONSTRAINT "PipelineJob_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineJob_accountId_fkey') THEN
        ALTER TABLE "PipelineJob" ADD CONSTRAINT "PipelineJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PipelineStepExecution_jobId_fkey') THEN
        ALTER TABLE "PipelineStepExecution" ADD CONSTRAINT "PipelineStepExecution_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PipelineJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsNode_releaseId_fkey') THEN
        ALTER TABLE "HtsNode" ADD CONSTRAINT "HtsNode_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "HtsRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsNode_parentId_fkey') THEN
        ALTER TABLE "HtsNode" ADD CONSTRAINT "HtsNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "HtsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsDutyRate_htsNodeId_fkey') THEN
        ALTER TABLE "HtsDutyRate" ADD CONSTRAINT "HtsDutyRate_htsNodeId_fkey" FOREIGN KEY ("htsNodeId") REFERENCES "HtsNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsUnit_htsNodeId_fkey') THEN
        ALTER TABLE "HtsUnit" ADD CONSTRAINT "HtsUnit_htsNodeId_fkey" FOREIGN KEY ("htsNodeId") REFERENCES "HtsNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalDocument_releaseId_fkey') THEN
        ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "HtsRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LegalFragment_legalDocumentId_fkey') THEN
        ALTER TABLE "LegalFragment" ADD CONSTRAINT "LegalFragment_legalDocumentId_fkey" FOREIGN KEY ("legalDocumentId") REFERENCES "LegalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsNoteLink_htsNodeId_fkey') THEN
        ALTER TABLE "HtsNoteLink" ADD CONSTRAINT "HtsNoteLink_htsNodeId_fkey" FOREIGN KEY ("htsNodeId") REFERENCES "HtsNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsNoteLink_legalFragmentId_fkey') THEN
        ALTER TABLE "HtsNoteLink" ADD CONSTRAINT "HtsNoteLink_legalFragmentId_fkey" FOREIGN KEY ("legalFragmentId") REFERENCES "LegalFragment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsChange_fromReleaseId_fkey') THEN
        ALTER TABLE "HtsChange" ADD CONSTRAINT "HtsChange_fromReleaseId_fkey" FOREIGN KEY ("fromReleaseId") REFERENCES "HtsRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsChange_toReleaseId_fkey') THEN
        ALTER TABLE "HtsChange" ADD CONSTRAINT "HtsChange_toReleaseId_fkey" FOREIGN KEY ("toReleaseId") REFERENCES "HtsRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsChange_oldHtsNodeId_fkey') THEN
        ALTER TABLE "HtsChange" ADD CONSTRAINT "HtsChange_oldHtsNodeId_fkey" FOREIGN KEY ("oldHtsNodeId") REFERENCES "HtsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HtsChange_newHtsNodeId_fkey') THEN
        ALTER TABLE "HtsChange" ADD CONSTRAINT "HtsChange_newHtsNodeId_fkey" FOREIGN KEY ("newHtsNodeId") REFERENCES "HtsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RulingFragment_rulingId_fkey') THEN
        ALTER TABLE "RulingFragment" ADD CONSTRAINT "RulingFragment_rulingId_fkey" FOREIGN KEY ("rulingId") REFERENCES "Ruling"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RulingHtsReference_rulingId_fkey') THEN
        ALTER TABLE "RulingHtsReference" ADD CONSTRAINT "RulingHtsReference_rulingId_fkey" FOREIGN KEY ("rulingId") REFERENCES "Ruling"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RulingRelationship_fromRulingId_fkey') THEN
        ALTER TABLE "RulingRelationship" ADD CONSTRAINT "RulingRelationship_fromRulingId_fkey" FOREIGN KEY ("fromRulingId") REFERENCES "Ruling"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RulingRelationship_toRulingId_fkey') THEN
        ALTER TABLE "RulingRelationship" ADD CONSTRAINT "RulingRelationship_toRulingId_fkey" FOREIGN KEY ("toRulingId") REFERENCES "Ruling"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassificationCase_accountId_fkey') THEN
        ALTER TABLE "ClassificationCase" ADD CONSTRAINT "ClassificationCase_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassificationSubject_caseId_fkey') THEN
        ALTER TABLE "ClassificationSubject" ADD CONSTRAINT "ClassificationSubject_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ClassificationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CaseDocument_caseId_fkey') THEN
        ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ClassificationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CaseDocument_accountId_fkey') THEN
        ALTER TABLE "CaseDocument" ADD CONSTRAINT "CaseDocument_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExtractedFact_caseId_fkey') THEN
        ALTER TABLE "ExtractedFact" ADD CONSTRAINT "ExtractedFact_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ClassificationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExtractedFact_documentId_fkey') THEN
        ALTER TABLE "ExtractedFact" ADD CONSTRAINT "ExtractedFact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "CaseDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassificationRun_caseId_fkey') THEN
        ALTER TABLE "ClassificationRun" ADD CONSTRAINT "ClassificationRun_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ClassificationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassificationProposal_runId_fkey') THEN
        ALTER TABLE "ClassificationProposal" ADD CONSTRAINT "ClassificationProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ClassificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassificationProposal_proposedHtsNodeId_fkey') THEN
        ALTER TABLE "ClassificationProposal" ADD CONSTRAINT "ClassificationProposal_proposedHtsNodeId_fkey" FOREIGN KEY ("proposedHtsNodeId") REFERENCES "HtsNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GriAnalysisStep_proposalId_fkey') THEN
        ALTER TABLE "GriAnalysisStep" ADD CONSTRAINT "GriAnalysisStep_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ClassificationProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProposalEvidence_proposalId_fkey') THEN
        ALTER TABLE "ProposalEvidence" ADD CONSTRAINT "ProposalEvidence_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ClassificationProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassificationDecision_caseId_fkey') THEN
        ALTER TABLE "ClassificationDecision" ADD CONSTRAINT "ClassificationDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ClassificationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassificationDecision_proposalId_fkey') THEN
        ALTER TABLE "ClassificationDecision" ADD CONSTRAINT "ClassificationDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ClassificationProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassificationDecision_approvedHtsNodeId_fkey') THEN
        ALTER TABLE "ClassificationDecision" ADD CONSTRAINT "ClassificationDecision_approvedHtsNodeId_fkey" FOREIGN KEY ("approvedHtsNodeId") REFERENCES "HtsNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Fact_shipmentId_fkey') THEN
        ALTER TABLE "Fact" ADD CONSTRAINT "Fact_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (guarded)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FilingSnapshot_filingId_fkey') THEN
        ALTER TABLE "FilingSnapshot" ADD CONSTRAINT "FilingSnapshot_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
