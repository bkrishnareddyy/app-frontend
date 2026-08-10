-- Columns and tables that only ever existed in the shared database. They were
-- never in prisma/migrations, so a database built from scratch would lack them
-- and `migrate diff` proposed dropping them from the shared one instead. They
-- are declared here so both directions agree.
--
-- Guarded throughout, since the shared database already has all of it.

-- AlterTable
ALTER TABLE "AgentExecutionLog" ADD COLUMN IF NOT EXISTS "runId" TEXT,
                                ADD COLUMN IF NOT EXISTS "triggerEvent" TEXT,
                                ADD COLUMN IF NOT EXISTS "invokedBy" TEXT,
                                ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;

-- AlterTable
ALTER TABLE "AgentExecutionRecord" ADD COLUMN IF NOT EXISTS "runId" TEXT;

-- AlterTable
ALTER TABLE "HtsRelease" ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'US';

-- AlterTable
ALTER TABLE "ExceptionItem" ADD COLUMN IF NOT EXISTS "documentId" TEXT,
                            ADD COLUMN IF NOT EXISTS "fieldKey" TEXT,
                            ADD COLUMN IF NOT EXISTS "resolvedByName" TEXT,
                            ADD COLUMN IF NOT EXISTS "resolutionNote" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "FieldApproval" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "documentId" TEXT,
    "fieldKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedByName" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentExecutionLog_runId_idx" ON "AgentExecutionLog"("runId");
CREATE INDEX IF NOT EXISTS "AgentExecutionRecord_runId_idx" ON "AgentExecutionRecord"("runId");
CREATE INDEX IF NOT EXISTS "HtsRelease_country_idx" ON "HtsRelease"("country");
CREATE INDEX IF NOT EXISTS "ExceptionItem_documentId_fieldKey_idx" ON "ExceptionItem"("documentId", "fieldKey");
CREATE INDEX IF NOT EXISTS "FieldApproval_shipmentId_fieldKey_idx" ON "FieldApproval"("shipmentId", "fieldKey");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExceptionItem_documentId_fkey') THEN
        ALTER TABLE "ExceptionItem" ADD CONSTRAINT "ExceptionItem_documentId_fkey"
            FOREIGN KEY ("documentId") REFERENCES "ShipmentDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FieldApproval_accountId_fkey') THEN
        ALTER TABLE "FieldApproval" ADD CONSTRAINT "FieldApproval_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FieldApproval_shipmentId_fkey') THEN
        ALTER TABLE "FieldApproval" ADD CONSTRAINT "FieldApproval_shipmentId_fkey"
            FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FieldApproval_documentId_fkey') THEN
        ALTER TABLE "FieldApproval" ADD CONSTRAINT "FieldApproval_documentId_fkey"
            FOREIGN KEY ("documentId") REFERENCES "ShipmentDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
