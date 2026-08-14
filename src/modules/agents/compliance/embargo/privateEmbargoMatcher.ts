// Country Embargo Screening -- Private account embargo matcher.
//
// KNOWN GAP: no private/account-specific embargo rule storage exists in the
// Qubere schema today, and no supplied source material identifies where
// such rules would live (CountryEmbargoScreening_Prompt.md section 18/26
// explicitly forbids inventing this storage or its rules). When an account
// has privateEmbargoEnabled=true, this matcher reports the capability gap
// explicitly as SKIPPED (never CLEAR -- a skipped check must never be
// mistaken for a passed one) so doEmbargoCheck.ts can fall through to the
// next applicable matcher in the precedence chain.
import type { EmbargoCheckContext, EmbargoCheckResult } from "./types";

export async function privateEmbargoMatcher(ctx: EmbargoCheckContext): Promise<EmbargoCheckResult> {
  return {
    result: "SKIPPED",
    complianceCountry: ctx.complianceCountry,
    screenedCountry: ctx.targetCountry,
    screeningLevel: ctx.screeningLevel,
    type: ctx.type,
    matcher: "PRIVATE",
    eccn: ctx.eccn,
    militaryEndUse: ctx.militaryEndUse,
    reason: "PRIVATE_EMBARGO_RULES_UNAVAILABLE",
    evidence: {
      note: "Private embargo rule storage is not implemented -- no supplied source material identifies it. Falling through to the next applicable matcher.",
    },
    context: ctx,
  };
}
