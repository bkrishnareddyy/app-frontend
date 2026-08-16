-- CreateTable
CREATE TABLE "ComplianceScreeningFinding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "lineNumber" INTEGER,
    "category" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceScreeningFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceScreeningFinding_accountId_category_createdAt_idx" ON "ComplianceScreeningFinding"("accountId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "ComplianceScreeningFinding_accountId_status_idx" ON "ComplianceScreeningFinding"("accountId", "status");

-- CreateIndex
CREATE INDEX "ComplianceScreeningFinding_shipmentId_idx" ON "ComplianceScreeningFinding"("shipmentId");

-- AddForeignKey
ALTER TABLE "ComplianceScreeningFinding" ADD CONSTRAINT "ComplianceScreeningFinding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceScreeningFinding" ADD CONSTRAINT "ComplianceScreeningFinding_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
