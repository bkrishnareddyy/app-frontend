// Country Embargo Screening -- deterministic per-check matcher dispatch.
//
// Precedence (CountryEmbargoScreening_Prompt.md section 16/19/25-28):
//   1. PRIVATE  -- if accountConfig.privateEmbargoEnabled. Falls through
//                  (does not short-circuit) when private rules are
//                  unavailable, since a SKIPPED private check is not itself
//                  a determination.
//   2. US       -- if complianceCountry resolves to "US"/"USA".
//   3. GENERIC  -- if server/generic screening is enabled for the account.
//   4. STANDARD -- fallback.
//
// KNOWN GAP: no supplied source material specifies this exact ordering (see
// usEmbargoMatcher.ts / privateEmbargoMatcher.ts) -- it is the most literal
// reading of the supplied conceptual precedence list. Do not change matcher
// internals to "fix" this; if the real precedence is supplied later, adjust
// dispatch here without touching the matcher modules themselves.
import { privateEmbargoMatcher } from "./privateEmbargoMatcher";
import { usEmbargoMatcher } from "./usEmbargoMatcher";
import { genericEmbargoMatcher } from "./genericEmbargoMatcher";
import { standardEmbargoMatcher } from "./standardEmbargoMatcher";
import type { EmbargoCheckContext, EmbargoCheckResult } from "./types";

const US_CODES = new Set(["US", "USA"]);

export async function doEmbargoCheck(ctx: EmbargoCheckContext): Promise<EmbargoCheckResult> {
  if (ctx.accountConfig.privateEmbargoEnabled) {
    const privateResult = await privateEmbargoMatcher(ctx);
    if (privateResult.result !== "SKIPPED") {
      return privateResult;
    }
  }

  if (US_CODES.has(ctx.complianceCountry.trim().toUpperCase())) {
    return usEmbargoMatcher(ctx);
  }

  if (ctx.accountConfig.serverScreeningEnabled || ctx.accountConfig.genericExportLdEnabled) {
    return genericEmbargoMatcher(ctx);
  }

  return standardEmbargoMatcher(ctx);
}
