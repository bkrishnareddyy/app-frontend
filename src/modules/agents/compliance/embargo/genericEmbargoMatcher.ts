// Country Embargo Screening -- Generic matcher.
//
// Used for non-US compliance countries when server/generic screening is
// enabled (accountConfig.serverScreeningEnabled / genericExportLdEnabled --
// the Qubere equivalent of the source SbsIndServerScreening /
// GenericExportLDEnabled subscriber flags, which the source DDL's
// cy_ind_glds column also gates). Runs the same reference-data-backed
// country-pair evaluation as the Standard matcher; kept as its own module
// (never referred to as "migrated") so generic-path-specific business rules
// can be added later without touching the Standard fallback.
import { evaluateCountryPair } from "./countryPairEvaluator";
import type { EmbargoCheckContext, EmbargoCheckResult } from "./types";

export async function genericEmbargoMatcher(ctx: EmbargoCheckContext): Promise<EmbargoCheckResult> {
  const result = await evaluateCountryPair(ctx, "GENERIC");
  return {
    ...result,
    evidence: { ...result.evidence, genericExportLdEnabled: ctx.accountConfig.genericExportLdEnabled },
  };
}
