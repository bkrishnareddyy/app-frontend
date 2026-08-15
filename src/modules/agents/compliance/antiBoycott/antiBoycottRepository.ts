// Anti-Boycott Screening -- repository layer.
//
// Country resolution reuses embargoRepository.resolveCountries rather than
// duplicating the cyId/cyName matching logic. Keyword reference data lives
// in ComplianceKeywordRule, shared with End-Use / Military End-Use Screening.
// Both are global reference data (no accountId column).
import { db } from "@/lib/db";
import type { ComplianceKeywordRule, Country } from "@prisma/client";
import { resolveCountries } from "../embargo/embargoRepository";

/** Resolves a single country identifier (business code or free-text name) to its `countries` row. */
export async function resolveBoycottCountry(value: string): Promise<Country | null> {
  const resolved = await resolveCountries([value]);
  return resolved.get(value) ?? null;
}

/** Published boycott-request keyword/phrase rules. Empty result must be treated as SKIPPED, never CLEAR. */
export async function getAntiBoycottKeywordRules(): Promise<ComplianceKeywordRule[]> {
  return db.complianceKeywordRule.findMany({
    where: { category: "ANTI_BOYCOTT_REQUEST", publicationStatus: "PUBLISHED" },
  });
}
