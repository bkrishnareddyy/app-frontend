// Military End-Use / End-User Screening -- repository layer.
//
// Keyword reference data lives in ComplianceKeywordRule (shared with End-Use
// / Anti-Boycott Screening). Entity reference data reuses ScreeningEntity
// with a new sourceList convention ("MEU_LIST"), mirroring the Phase 1
// UFLPA_ENTITY_LIST precedent -- no new schema required. Both tables are
// global reference data (no accountId column).
import { db } from "@/lib/db";
import type { ComplianceKeywordRule, ScreeningEntity } from "@prisma/client";

/** Published military-end-use keyword/phrase rules. Empty result must be treated as SKIPPED, never CLEAR. */
export async function getMilitaryEndUseKeywordRules(): Promise<ComplianceKeywordRule[]> {
  return db.complianceKeywordRule.findMany({
    where: { category: "MILITARY_END_USE", publicationStatus: "PUBLISHED" },
  });
}

/** Published BIS Military End User (MEU) List rows. Empty result must be treated as SKIPPED, never CLEAR. */
export async function getMilitaryEndUserList(): Promise<ScreeningEntity[]> {
  return db.screeningEntity.findMany({
    where: { sourceList: "MEU_LIST", publicationStatus: "PUBLISHED" },
  });
}
