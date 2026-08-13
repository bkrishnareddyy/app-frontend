-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "destinationCountry" TEXT;

-- CreateTable
CREATE TABLE "CustomsFilingMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "correlationId" TEXT,
    "priorMessageId" TEXT,
    "messageName" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "procedure" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "status" TEXT,
    "envelope" JSONB NOT NULL,
    "queueStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "lockedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "CustomsFilingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalSchemaVersion" (
    "id" TEXT NOT NULL,
    "schemaType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalSchemaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalResponseStatusMapping" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "messageName" TEXT NOT NULL,
    "canonicalStatus" TEXT NOT NULL,
    "filingTransition" TEXT NOT NULL,

    CONSTRAINT "CanonicalResponseStatusMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalMessageAction" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requiresPriorMessage" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CanonicalMessageAction_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "FilingProcedureMapping" (
    "id" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "procedureCode" TEXT NOT NULL,

    CONSTRAINT "FilingProcedureMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingMessageCatalog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "procedureCode" TEXT NOT NULL,
    "messageName" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,

    CONSTRAINT "FilingMessageCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingActionRule" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "procedureCode" TEXT NOT NULL,
    "messageName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "allowUpdates" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FilingActionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomsFilingMessage_messageId_key" ON "CustomsFilingMessage"("messageId");

-- CreateIndex
CREATE INDEX "CustomsFilingMessage_accountId_idx" ON "CustomsFilingMessage"("accountId");

-- CreateIndex
CREATE INDEX "CustomsFilingMessage_filingId_idx" ON "CustomsFilingMessage"("filingId");

-- CreateIndex
CREATE INDEX "CustomsFilingMessage_correlationId_idx" ON "CustomsFilingMessage"("correlationId");

-- CreateIndex
CREATE INDEX "CustomsFilingMessage_queueStatus_createdAt_idx" ON "CustomsFilingMessage"("queueStatus", "createdAt");

-- CreateIndex
CREATE INDEX "CanonicalSchemaVersion_schemaType_status_idx" ON "CanonicalSchemaVersion"("schemaType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalSchemaVersion_schemaType_version_key" ON "CanonicalSchemaVersion"("schemaType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalResponseStatusMapping_country_messageName_canonica_key" ON "CanonicalResponseStatusMapping"("country", "messageName", "canonicalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "FilingProcedureMapping_entryType_country_key" ON "FilingProcedureMapping"("entryType", "country");

-- CreateIndex
CREATE UNIQUE INDEX "FilingMessageCatalog_action_country_procedureCode_key" ON "FilingMessageCatalog"("action", "country", "procedureCode");

-- CreateIndex
CREATE UNIQUE INDEX "FilingActionRule_country_procedureCode_messageName_status_key" ON "FilingActionRule"("country", "procedureCode", "messageName", "status");

-- AddForeignKey
ALTER TABLE "CustomsFilingMessage" ADD CONSTRAINT "CustomsFilingMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomsFilingMessage" ADD CONSTRAINT "CustomsFilingMessage_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

