import { db } from "@/lib/db";
import type { AuditCheckResult } from "@/modules/agents/complianceAuditAgent";

/**
 * The six screening categories the Compliance workspace organizes findings
 * by. Restricted Party / Party Red Flag are deliberately absent -- those
 * already persist to RestrictedPartyScreeningResult/Match and are read from
 * there, never duplicated into this generic table.
 */
export type ScreeningBucket =
  | "COUNTRY_EMBARGO"
  | "UFLPA"
  | "END_USE_RESTRICTION"
  | "END_USER_RESTRICTION"
  | "ANTI_BOYCOTT"
  | "MILITARY_END_USE"
  | "MILITARY_END_USER";

const DIRECT_CATEGORY_MAP: Partial<Record<AuditCheckResult["category"], ScreeningBucket>> = {
  COUNTRY_EMBARGO: "COUNTRY_EMBARGO",
  UFLPA: "UFLPA",
  END_USE_RESTRICTION: "END_USE_RESTRICTION",
  END_USER_RESTRICTION: "END_USER_RESTRICTION",
  ANTI_BOYCOTT: "ANTI_BOYCOTT",
  MILITARY_END_USE: "MILITARY_END_USE",
  MILITARY_END_USER: "MILITARY_END_USER",
};

/** SCREENING_GAP rows carry no category of their own -- infer one from the rule name so a gap still surfaces under the right sub-tab, not as an untraceable orphan. */
function bucketFromGapRuleName(ruleName: string): ScreeningBucket | null {
  const name = ruleName.toLowerCase();
  if (name.includes("restricted party") || name.includes("party red flag")) return null;
  if (name.includes("country embargo")) return "COUNTRY_EMBARGO";
  if (name.includes("uflpa") || name.includes("forced labor")) return "UFLPA";
  if (name.includes("end-user") || name.includes("end user")) return "END_USER_RESTRICTION";
  if (name.includes("end-use") || name.includes("end use")) return "END_USE_RESTRICTION";
  if (name.includes("anti-boycott") || name.includes("boycott")) return "ANTI_BOYCOTT";
  if (name.includes("military end-user") || name.includes("military end user")) return "MILITARY_END_USER";
  if (name.includes("military")) return "MILITARY_END_USE";
  return null;
}

function resolveBucket(result: AuditCheckResult): ScreeningBucket | null {
  const direct = DIRECT_CATEGORY_MAP[result.category];
  if (direct) return direct;
  if (result.category === "SCREENING_GAP") return bucketFromGapRuleName(result.ruleName);
  return null;
}

/**
 * Persists one immutable ComplianceScreeningFinding row per failing
 * AuditCheckResult that belongs to one of the six Screening workspace
 * categories. Passing checks and non-screening categories (PGA, ADD/CVD,
 * Valuation, HTS Integrity, Data Missing) are not this table's concern.
 */
export async function persistComplianceScreeningFindings(
  accountId: string,
  shipmentId: string,
  auditResults: AuditCheckResult[]
): Promise<void> {
  const rows = auditResults
    .filter((r) => !r.passed)
    .map((r) => {
      const category = resolveBucket(r);
      if (!category) return null;
      return {
        accountId,
        shipmentId,
        lineNumber: r.lineNumber ?? null,
        category,
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        severity: r.severity,
        details: r.details,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;

  await db.complianceScreeningFinding.createMany({ data: rows });
}
