-- DropIndex
DROP INDEX "commerce_control_list_ccl_id_ccl_cy_seq_idx";

-- DropIndex
DROP INDEX "country_by_country_maps_cycy_from_cy_seq_cycy_to_cy_seq_idx";

-- DropIndex
DROP INDEX "country_group_maps_cygrm_cy_seq_cygrm_cyg_seq_idx";

-- DropIndex
DROP INDEX "cy_ccg_maps_cygm_cy_seq_cygm_ccg_seq_idx";

-- AlterTable
ALTER TABLE "commerce_control_list" DROP COLUMN "ccl_cy_seq",
ADD COLUMN     "CCL_COUNTRY" TEXT;

-- AlterTable
ALTER TABLE "country_by_country_maps" DROP COLUMN "cycy_from_cy_seq",
DROP COLUMN "cycy_ind_embargoed",
DROP COLUMN "cycy_ind_eu_sanction",
DROP COLUMN "cycy_ind_national_sanction",
DROP COLUMN "cycy_ind_un_sanction",
DROP COLUMN "cycy_to_cy_seq",
ADD COLUMN     "COMPLIANCE_COUNTRY" TEXT NOT NULL,
ADD COLUMN     "COMPLIANCE_COUNTRY_NAME" TEXT,
ADD COLUMN     "CYCY_IND_EMBARGOED" TEXT,
ADD COLUMN     "CYCY_IND_EU_SANCTION" TEXT,
ADD COLUMN     "CYCY_IND_NATIONAL_SANCTION" TEXT,
ADD COLUMN     "CYCY_IND_UN_SANCTION" TEXT,
ADD COLUMN     "EMBARGOED_COUNTRY" TEXT NOT NULL,
ADD COLUMN     "EMBARGOED_COUNTRY_NAME" TEXT;

-- AlterTable
ALTER TABLE "country_group_maps" DROP COLUMN "cygrm_cy_seq",
DROP COLUMN "cygrm_cyg_seq",
ADD COLUMN     "COUNTRY_ID" TEXT NOT NULL,
ADD COLUMN     "GROUP_ID" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cy_ccg_maps" DROP COLUMN "cygm_ccg_seq",
DROP COLUMN "cygm_cy_seq",
ADD COLUMN     "COMPLIANCE_GROUP_ID" TEXT NOT NULL,
ADD COLUMN     "COUNTRY_ID" TEXT NOT NULL;


-- CreateIndex
CREATE INDEX "commerce_control_list_ccl_id_CCL_COUNTRY_idx" ON "commerce_control_list"("ccl_id", "CCL_COUNTRY");

-- CreateIndex
CREATE INDEX "country_by_country_maps_COMPLIANCE_COUNTRY_EMBARGOED_COUNTR_idx" ON "country_by_country_maps"("COMPLIANCE_COUNTRY", "EMBARGOED_COUNTRY");

-- CreateIndex
CREATE INDEX "country_group_maps_COUNTRY_ID_GROUP_ID_idx" ON "country_group_maps"("COUNTRY_ID", "GROUP_ID");

-- CreateIndex
CREATE INDEX "cy_ccg_maps_COUNTRY_ID_COMPLIANCE_GROUP_ID_idx" ON "cy_ccg_maps"("COUNTRY_ID", "COMPLIANCE_GROUP_ID");

