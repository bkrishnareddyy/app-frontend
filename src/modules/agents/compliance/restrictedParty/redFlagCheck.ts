// Restricted / Denied-Party Screening -- red-flag word check.
//
// Independent of denial-order matching -- additive, never merged. Reuses
// keywordMatch.ts's screenText, the same primitive endUse/militaryEndUse/
// antiBoycott already use against ComplianceKeywordRule.
import { screenText } from "@/lib/screening/keywordMatch";
import type { ComplianceKeywordRule } from "@prisma/client";
import type { RestrictedPartyRedFlagHitCandidate } from "./types";

export function checkRedFlags(screenedName: string, rules: ComplianceKeywordRule[]): RestrictedPartyRedFlagHitCandidate[] {
  const matches = screenText(screenedName, rules);
  return matches.map((rule) => ({ keywordRuleId: rule.id, matchedWord: rule.phrase }));
}
