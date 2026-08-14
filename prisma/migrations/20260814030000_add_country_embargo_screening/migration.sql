-- CreateTable
CREATE TABLE "countries" (
    "cy_seq" INTEGER NOT NULL,
    "cy_id" TEXT NOT NULL,
    "cy_name" TEXT,
    "cy_shrt_name" TEXT,
    "cy_ind_embargoed" TEXT,
    "cy_ind_boycotted" TEXT,
    "cy_ind_dps" TEXT,
    "cy_ind_lds" TEXT,
    "cy_ind_ems" TEXT,
    "CY_IND_GLDS" TEXT,
    "cy_dt_crt" TIMESTAMP(3),
    "cy_dt_upd" TIMESTAMP(3),

    CONSTRAINT "countries_pkey" PRIMARY KEY ("cy_seq")
);

-- CreateTable
CREATE TABLE "country_groups" (
    "cyg_seq" INTEGER NOT NULL,
    "cyg_id" TEXT NOT NULL,
    "cyg_shrt_name" TEXT NOT NULL,
    "cyg_desc" TEXT,
    "cyg_ind_hts" TEXT,

    CONSTRAINT "country_groups_pkey" PRIMARY KEY ("cyg_seq")
);

-- CreateTable
CREATE TABLE "country_group_maps" (
    "cygrm_seq" INTEGER NOT NULL,
    "cygrm_cy_seq" INTEGER NOT NULL,
    "cygrm_cyg_seq" INTEGER NOT NULL,
    "CYGRM_EFFECTIVE_DT" TIMESTAMP(3),
    "CYGRM_EXPIRATION_DT" TIMESTAMP(3),

    CONSTRAINT "country_group_maps_pkey" PRIMARY KEY ("cygrm_seq")
);

-- CreateTable
CREATE TABLE "compliance_country_groups" (
    "ccg_seq" INTEGER NOT NULL,
    "ccg_id" TEXT,
    "ccg_desc" TEXT,

    CONSTRAINT "compliance_country_groups_pkey" PRIMARY KEY ("ccg_seq")
);

-- CreateTable
CREATE TABLE "cy_ccg_maps" (
    "cygm_seq" INTEGER NOT NULL,
    "cygm_cy_seq" INTEGER NOT NULL,
    "cygm_ccg_seq" INTEGER NOT NULL,

    CONSTRAINT "cy_ccg_maps_pkey" PRIMARY KEY ("cygm_seq")
);

-- CreateTable
CREATE TABLE "country_by_country_maps" (
    "cycy_seq" INTEGER NOT NULL,
    "cycy_from_cy_seq" INTEGER NOT NULL,
    "cycy_to_cy_seq" INTEGER NOT NULL,
    "cycy_ind_embargoed" TEXT,
    "cycy_ind_national_sanction" TEXT,
    "cycy_ind_eu_sanction" TEXT,
    "cycy_ind_un_sanction" TEXT,

    CONSTRAINT "country_by_country_maps_pkey" PRIMARY KEY ("cycy_seq")
);

-- CreateTable
CREATE TABLE "commerce_control_list" (
    "ccl_seq" INTEGER NOT NULL,
    "ccl_id" TEXT NOT NULL,
    "ccl_desc" TEXT NOT NULL,
    "ccl_cy_seq" INTEGER,
    "ccl_ind_un" TEXT,
    "ccl_ind_ofac_ctl" TEXT,
    "ccl_licensable" TEXT,

    CONSTRAINT "commerce_control_list_pkey" PRIMARY KEY ("ccl_seq")
);

-- CreateTable
CREATE TABLE "AccountEmbargoConfig" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "embargoScreeningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "privateEmbargoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "serverScreeningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "genericExportLdEnabled" BOOLEAN NOT NULL DEFAULT false,
    "audited" BOOLEAN NOT NULL DEFAULT false,
    "emailAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
    "generalAuditLogEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountEmbargoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbargoUsageHeader" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "transactionId" TEXT,
    "screeningType" TEXT NOT NULL DEFAULT 'COUNTRY_EMBARGO',
    "correlationId" TEXT,
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbargoUsageHeader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbargoUsageLine" (
    "id" TEXT NOT NULL,
    "headerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "transactionId" TEXT,
    "partyId" TEXT,
    "lineItemId" TEXT,
    "userDefined" TEXT,
    "exceptionType" TEXT NOT NULL DEFAULT 'EM',
    "screeningLevel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "complianceCountry" TEXT NOT NULL,
    "screenedCountry" TEXT NOT NULL,
    "eccn" TEXT,
    "militaryEndUse" BOOLEAN,
    "matcher" TEXT NOT NULL,
    "ruleId" TEXT,
    "result" TEXT NOT NULL,
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidence" JSONB,

    CONSTRAINT "EmbargoUsageLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "countries_cy_id_idx" ON "countries"("cy_id");

-- CreateIndex
CREATE INDEX "countries_cy_name_idx" ON "countries"("cy_name");

-- CreateIndex
CREATE INDEX "country_groups_cyg_id_idx" ON "country_groups"("cyg_id");

-- CreateIndex
CREATE INDEX "country_group_maps_cygrm_cy_seq_cygrm_cyg_seq_idx" ON "country_group_maps"("cygrm_cy_seq", "cygrm_cyg_seq");

-- CreateIndex
CREATE INDEX "country_group_maps_CYGRM_EFFECTIVE_DT_CYGRM_EXPIRATION_DT_idx" ON "country_group_maps"("CYGRM_EFFECTIVE_DT", "CYGRM_EXPIRATION_DT");

-- CreateIndex
CREATE INDEX "compliance_country_groups_ccg_id_idx" ON "compliance_country_groups"("ccg_id");

-- CreateIndex
CREATE INDEX "cy_ccg_maps_cygm_cy_seq_cygm_ccg_seq_idx" ON "cy_ccg_maps"("cygm_cy_seq", "cygm_ccg_seq");

-- CreateIndex
CREATE INDEX "country_by_country_maps_cycy_from_cy_seq_cycy_to_cy_seq_idx" ON "country_by_country_maps"("cycy_from_cy_seq", "cycy_to_cy_seq");

-- CreateIndex
CREATE INDEX "commerce_control_list_ccl_id_ccl_cy_seq_idx" ON "commerce_control_list"("ccl_id", "ccl_cy_seq");

-- CreateIndex
CREATE UNIQUE INDEX "AccountEmbargoConfig_accountId_key" ON "AccountEmbargoConfig"("accountId");

-- CreateIndex
CREATE INDEX "EmbargoUsageHeader_accountId_shipmentId_idx" ON "EmbargoUsageHeader"("accountId", "shipmentId");

-- CreateIndex
CREATE INDEX "EmbargoUsageHeader_screenedAt_idx" ON "EmbargoUsageHeader"("screenedAt");

-- CreateIndex
CREATE INDEX "EmbargoUsageLine_headerId_idx" ON "EmbargoUsageLine"("headerId");

-- CreateIndex
CREATE INDEX "EmbargoUsageLine_accountId_shipmentId_idx" ON "EmbargoUsageLine"("accountId", "shipmentId");

-- AddForeignKey
ALTER TABLE "AccountEmbargoConfig" ADD CONSTRAINT "AccountEmbargoConfig_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbargoUsageHeader" ADD CONSTRAINT "EmbargoUsageHeader_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbargoUsageLine" ADD CONSTRAINT "EmbargoUsageLine_headerId_fkey" FOREIGN KEY ("headerId") REFERENCES "EmbargoUsageHeader"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbargoUsageLine" ADD CONSTRAINT "EmbargoUsageLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

