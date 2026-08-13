-- CreateTable: AccountWebhook
CREATE TABLE "AccountWebhook" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastDeliveryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WebhookDeliveryLog
CREATE TABLE "WebhookDeliveryLog" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AccountApiKey
CREATE TABLE "AccountApiKey" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountWebhook_accountId_idx" ON "AccountWebhook"("accountId");
CREATE INDEX "AccountWebhook_status_idx" ON "AccountWebhook"("status");
CREATE INDEX "WebhookDeliveryLog_webhookId_idx" ON "WebhookDeliveryLog"("webhookId");
CREATE INDEX "WebhookDeliveryLog_eventId_idx" ON "WebhookDeliveryLog"("eventId");
CREATE INDEX "WebhookDeliveryLog_createdAt_idx" ON "WebhookDeliveryLog"("createdAt");
CREATE UNIQUE INDEX "AccountApiKey_keyHash_key" ON "AccountApiKey"("keyHash");
CREATE INDEX "AccountApiKey_accountId_idx" ON "AccountApiKey"("accountId");
CREATE INDEX "AccountApiKey_keyHash_idx" ON "AccountApiKey"("keyHash");

-- AddForeignKey
ALTER TABLE "AccountWebhook" ADD CONSTRAINT "AccountWebhook_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookDeliveryLog" ADD CONSTRAINT "WebhookDeliveryLog_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "AccountWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountApiKey" ADD CONSTRAINT "AccountApiKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F-5: Data lineage columns on ShipmentLineItem
ALTER TABLE "ShipmentLineItem" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "ShipmentLineItem" ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT;
ALTER TABLE "ShipmentLineItem" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
