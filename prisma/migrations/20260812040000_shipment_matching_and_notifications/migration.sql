-- CreateTable
CREATE TABLE "DocumentShipmentCandidate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "matchedIdentifierType" TEXT NOT NULL,
    "matchedValue" TEXT NOT NULL,
    "matchedSource" TEXT NOT NULL,
    "autoSelected" BOOLEAN NOT NULL DEFAULT false,
    "algorithmVersion" TEXT NOT NULL DEFAULT 'v1-exact-identifier',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentShipmentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentShipmentCandidate_documentId_idx" ON "DocumentShipmentCandidate"("documentId");

-- CreateIndex
CREATE INDEX "DocumentShipmentCandidate_shipmentId_idx" ON "DocumentShipmentCandidate"("shipmentId");

-- CreateIndex
CREATE INDEX "Notification_accountId_userId_read_idx" ON "Notification"("accountId", "userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DocumentShipmentCandidate" ADD CONSTRAINT "DocumentShipmentCandidate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentShipmentCandidate" ADD CONSTRAINT "DocumentShipmentCandidate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ShipmentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentShipmentCandidate" ADD CONSTRAINT "DocumentShipmentCandidate_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

