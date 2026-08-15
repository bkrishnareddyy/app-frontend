// End-Use Screening -- deterministic orchestrator.
//
// Screens the shipment's stated end-use text against published restricted-
// end-use keyword rules. No text and no reference data must both resolve to
// SKIPPED, never CLEAR. Status derivation mirrors forcedLaborScreening.ts.
import { screenText } from "@/lib/screening/keywordMatch";
import { getEndUseKeywordRules } from "./endUseRepository";
import type { EndUseScreeningInput, EndUseScreeningResult, EndUseHit, EndUseSkip, EndUseError } from "./types";

export async function runEndUseScreening(input: EndUseScreeningInput): Promise<EndUseScreeningResult> {
  const hits: EndUseHit[] = [];
  const skipped: EndUseSkip[] = [];
  const errors: EndUseError[] = [];
  let checksRun = 0;

  let rules: Awaited<ReturnType<typeof getEndUseKeywordRules>> = [];
  try {
    rules = await getEndUseKeywordRules();
  } catch (err) {
    errors.push({ code: "REPOSITORY_ERROR", message: err instanceof Error ? err.message : String(err) });
  }

  if (errors.length === 0) {
    if (rules.length === 0) {
      skipped.push({ reason: "No restricted-end-use reference data is loaded (ComplianceKeywordRule table has no published END_USE_* rows)." });
    } else if (!input.endUseStatement || !input.endUseStatement.trim()) {
      skipped.push({ reason: "No end-use statement is available to screen." });
    } else {
      checksRun++;
      const matches = screenText(input.endUseStatement, rules);
      for (const rule of matches) {
        hits.push({
          category: rule.category as EndUseHit["category"],
          matchedPhrase: rule.phrase,
          citation: rule.citation,
          severity: rule.severity,
          reason: `Stated end-use text matches restricted-end-use phrase "${rule.phrase}" (${rule.category}).${rule.citation ? ` See ${rule.citation}.` : ""} Manual review required before release.`,
        });
      }
    }
  }

  const hasHits = hits.length > 0;
  const hasErrors = errors.length > 0;

  let status: EndUseScreeningResult["status"];
  if (hasHits && hasErrors) status = "PARTIAL";
  else if (hasHits) status = "HIT";
  else if (hasErrors) status = "ERROR";
  else if (checksRun === 0) status = "SKIPPED";
  else status = "CLEAR";

  return { status, hits, skipped, errors, checksRun };
}
