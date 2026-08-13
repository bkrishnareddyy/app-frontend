-- CreateTable
CREATE TABLE "ClassificationChangeImpact" (
    "id" TEXT NOT NULL,
    "classificationDecisionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "filingId" TEXT,
    "previousHtsCode" TEXT,
    "newHtsCode" TEXT NOT NULL,
    "dutyImpact" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationChangeImpact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassificationChangeImpact_classificationDecisionId_idx" ON "ClassificationChangeImpact"("classificationDecisionId");

-- CreateIndex
CREATE INDEX "ClassificationChangeImpact_shipmentId_idx" ON "ClassificationChangeImpact"("shipmentId");

-- CreateIndex
CREATE INDEX "ClassificationChangeImpact_accountId_idx" ON "ClassificationChangeImpact"("accountId");

-- AddForeignKey
ALTER TABLE "ClassificationChangeImpact" ADD CONSTRAINT "ClassificationChangeImpact_classificationDecisionId_fkey" FOREIGN KEY ("classificationDecisionId") REFERENCES "ClassificationDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationChangeImpact" ADD CONSTRAINT "ClassificationChangeImpact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationChangeImpact" ADD CONSTRAINT "ClassificationChangeImpact_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationChangeImpact" ADD CONSTRAINT "ClassificationChangeImpact_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "CustomsFiling"("id") ON DELETE SET NULL ON UPDATE CASCADE;
