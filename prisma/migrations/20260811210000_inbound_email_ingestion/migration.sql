-- AlterTable
ALTER TABLE "ShipmentDocument" ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'UPLOAD';

-- CreateTable
CREATE TABLE "InboundSenderRoute" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "normalizedSenderEmail" TEXT NOT NULL,
    "displaySenderEmail" TEXT NOT NULL,
    "defaultAssignedToUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundSenderRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "providerEventId" TEXT NOT NULL,
    "providerEmailId" TEXT NOT NULL,
    "normalizedFromAddress" TEXT NOT NULL,
    "originalFromAddress" TEXT NOT NULL,
    "toAddresses" TEXT NOT NULL,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "routingStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "quarantineReason" TEXT,
    "authHeaders" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundAttachment" (
    "id" TEXT NOT NULL,
    "inboundEmailId" TEXT NOT NULL,
    "providerAttachmentId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "declaredMimeType" TEXT,
    "contentDisposition" TEXT,
    "actualSize" INTEGER,
    "checksum" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "shipmentDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundSenderRoute_normalizedSenderEmail_key" ON "InboundSenderRoute"("normalizedSenderEmail");

-- CreateIndex
CREATE INDEX "InboundSenderRoute_accountId_idx" ON "InboundSenderRoute"("accountId");

-- CreateIndex
CREATE INDEX "InboundEmail_accountId_idx" ON "InboundEmail"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_provider_providerEventId_key" ON "InboundEmail"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_provider_providerEmailId_key" ON "InboundEmail"("provider", "providerEmailId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundAttachment_shipmentDocumentId_key" ON "InboundAttachment"("shipmentDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundAttachment_inboundEmailId_providerAttachmentId_key" ON "InboundAttachment"("inboundEmailId", "providerAttachmentId");

-- AddForeignKey
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundSenderRoute" ADD CONSTRAINT "InboundSenderRoute_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundSenderRoute" ADD CONSTRAINT "InboundSenderRoute_defaultAssignedToUserId_fkey" FOREIGN KEY ("defaultAssignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundAttachment" ADD CONSTRAINT "InboundAttachment_inboundEmailId_fkey" FOREIGN KEY ("inboundEmailId") REFERENCES "InboundEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundAttachment" ADD CONSTRAINT "InboundAttachment_shipmentDocumentId_fkey" FOREIGN KEY ("shipmentDocumentId") REFERENCES "ShipmentDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

