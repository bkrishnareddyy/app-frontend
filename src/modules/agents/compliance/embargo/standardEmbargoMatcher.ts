// Country Embargo Screening -- Standard/Fallback matcher.
// Used when no Private, US-specific, or Generic/server-screening path applies.
import { evaluateCountryPair } from "./countryPairEvaluator";
import type { EmbargoCheckContext, EmbargoCheckResult } from "./types";

export async function standardEmbargoMatcher(ctx: EmbargoCheckContext): Promise<EmbargoCheckResult> {
  return evaluateCountryPair(ctx, "STANDARD");
}
