// Country Embargo Screening -- US-specific matcher.
//
// KNOWN GAP: the supplied business-logic spec requires a dedicated US
// matcher with its own precedence ("Do not collapse US-specific logic into
// generic country screening", "Do not invent missing precedence"), but no
// supplied source material (Java implementation, etc.) defines what that
// US-specific precedence actually is beyond the shared country-pair/CCL
// evaluation every matcher performs. This module is isolated -- as required
// -- so real US-specific precedence (e.g. distinct OFAC/BIS rule ordering)
// can be added here later without changing doEmbargoCheck.ts's dispatch or
// any call sites. Until that source material is supplied, it runs the same
// deterministic country-pair evaluation as Standard/Generic, tagged "US" so
// audit trails/tests can distinguish the path taken from the outcome logic.
import { evaluateCountryPair } from "./countryPairEvaluator";
import type { EmbargoCheckContext, EmbargoCheckResult } from "./types";

export async function usEmbargoMatcher(ctx: EmbargoCheckContext): Promise<EmbargoCheckResult> {
  return evaluateCountryPair(ctx, "US");
}
