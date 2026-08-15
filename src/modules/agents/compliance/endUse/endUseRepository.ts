// End-Use Screening -- repository layer.
//
// Reference data lives in ComplianceKeywordRule, shared with Military End-Use
// and Anti-Boycott Screening. Global reference data (no accountId column).
import { db } from "@/lib/db";
import type { ComplianceKeywordRule } from "@prisma/client";

const END_USE_CATEGORIES = ["END_USE_NUCLEAR", "END_USE_MISSILE", "END_USE_CHEM_BIO", "END_USE_ROCKET_UAV"];

/** Published restricted-end-use keyword/phrase rules. Empty result must be treated as SKIPPED, never CLEAR. */
export async function getEndUseKeywordRules(): Promise<ComplianceKeywordRule[]> {
  return db.complianceKeywordRule.findMany({
    where: { category: { in: END_USE_CATEGORIES }, publicationStatus: "PUBLISHED" },
  });
}
