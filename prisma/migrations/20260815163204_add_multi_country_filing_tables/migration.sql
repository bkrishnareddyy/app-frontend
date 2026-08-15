-- CreateTable
CREATE TABLE "FilingTransactionType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "FilingTransactionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingActionCatalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "FilingActionCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingProcedureConfig" (
    "id" TEXT NOT NULL,
    "transactionTypeId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "procedureCode" TEXT NOT NULL,
    "messageName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "FilingProcedureConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingActionMessageMapping" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "procedureCode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "messageName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "FilingActionMessageMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingActionConfiguration" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "procedureCode" TEXT NOT NULL,
    "messageName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "availableActions" TEXT[],
    "allowSubmit" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "FilingActionConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilingTransactionType_code_key" ON "FilingTransactionType"("code");

-- CreateIndex
CREATE INDEX "FilingTransactionType_code_idx" ON "FilingTransactionType"("code");

-- CreateIndex
CREATE INDEX "FilingTransactionType_isActive_idx" ON "FilingTransactionType"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FilingActionCatalog_code_key" ON "FilingActionCatalog"("code");

-- CreateIndex
CREATE INDEX "FilingActionCatalog_code_idx" ON "FilingActionCatalog"("code");

-- CreateIndex
CREATE INDEX "FilingActionCatalog_isActive_idx" ON "FilingActionCatalog"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FilingProcedureConfig_country_procedureCode_messageName_key" ON "FilingProcedureConfig"("country", "procedureCode", "messageName");

-- CreateIndex
CREATE INDEX "FilingProcedureConfig_country_procedureCode_idx" ON "FilingProcedureConfig"("country", "procedureCode");

-- CreateIndex
CREATE INDEX "FilingProcedureConfig_transactionTypeId_idx" ON "FilingProcedureConfig"("transactionTypeId");

-- CreateIndex
CREATE INDEX "FilingProcedureConfig_isActive_idx" ON "FilingProcedureConfig"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FilingActionMessageMapping_country_procedureCode_action_key" ON "FilingActionMessageMapping"("country", "procedureCode", "action");

-- CreateIndex
CREATE INDEX "FilingActionMessageMapping_country_procedureCode_idx" ON "FilingActionMessageMapping"("country", "procedureCode");

-- CreateIndex
CREATE INDEX "FilingActionMessageMapping_action_idx" ON "FilingActionMessageMapping"("action");

-- CreateIndex
CREATE INDEX "FilingActionMessageMapping_isActive_idx" ON "FilingActionMessageMapping"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FilingActionConfiguration_country_procedureCode_messageName_s_key" ON "FilingActionConfiguration"("country", "procedureCode", "messageName", "status");

-- CreateIndex
CREATE INDEX "FilingActionConfiguration_country_procedureCode_messageName_idx" ON "FilingActionConfiguration"("country", "procedureCode", "messageName");

-- CreateIndex
CREATE INDEX "FilingActionConfiguration_isActive_idx" ON "FilingActionConfiguration"("isActive");

-- AddForeignKey
ALTER TABLE "FilingProcedureConfig" ADD CONSTRAINT "FilingProcedureConfig_transactionTypeId_fkey" FOREIGN KEY ("transactionTypeId") REFERENCES "FilingTransactionType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
