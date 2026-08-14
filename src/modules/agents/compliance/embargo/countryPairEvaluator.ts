// Country Embargo Screening -- shared deterministic country-pair evaluation.
//
// This is the core algorithm common to the US / Generic / Standard matchers
// (each of which is a distinct, isolated module per
// CountryEmbargoScreening_Prompt.md section 11, so future matcher-specific
// precedence can be layered in without touching call sites). It:
//   1. resolves both countries (ERROR if either is unresolvable -- never CLEAR)
//   2. looks up the direct country_by_country_maps row and distinguishes
//      DIRECT HIT / DIRECT CLEAR / NO DIRECT RULE (section 22 -- a direct "N"
//      row is never treated as equivalent to "no row")
//   3. attaches country-group membership evidence (informational only --
//      see countryGroupMatcher.ts for why it cannot drive the determination)
//   4. attaches CCL/ECCN evidence when an ECCN is available (informational
//      only). The supplied core-logic spec (section 29) names CCL_IND_UN,
//      CCL_IND_OFAC_CTL, and CCL_LICENSABLE as the fields to evaluate but
//      never defines how they modify a HIT/CLEAR outcome (e.g. no rule such
//      as "CCL_IND_UN = Y forces a HIT" is given). Per section 62 ("do not
//      invent ECCN compliance rules"), the raw commerce_control_list rows --
//      including those three fields -- are surfaced as evidence only; they
//      never drive `result` here. See doEmbargoCheck.ts.
import { resolveCountries, getCountryRelationship, getCommerceControlListEntries } from "./embargoRepository";
import { resolveCountryGroupEvidence } from "./countryGroupMatcher";
import type { EmbargoCheckContext, EmbargoCheckResult, EmbargoMatcherName } from "./types";

export async function evaluateCountryPair(
  ctx: EmbargoCheckContext,
  matcher: EmbargoMatcherName
): Promise<EmbargoCheckResult> {
  const base = {
    complianceCountry: ctx.complianceCountry,
    screenedCountry: ctx.targetCountry,
    screeningLevel: ctx.screeningLevel,
    type: ctx.type,
    matcher,
    eccn: ctx.eccn,
    militaryEndUse: ctx.militaryEndUse,
    context: ctx,
  };

  const resolved = await resolveCountries([ctx.complianceCountry, ctx.targetCountry]);
  const complianceCountry = resolved.get(ctx.complianceCountry);
  const targetCountry = resolved.get(ctx.targetCountry);

  if (!complianceCountry || !targetCountry) {
    return {
      ...base,
      result: "ERROR",
      reason: "COUNTRY_NOT_RESOLVED",
      evidence: {
        complianceCountryResolved: Boolean(complianceCountry),
        targetCountryResolved: Boolean(targetCountry),
      },
    };
  }

  const [relationship, groupEvidence, cclEntries] = await Promise.all([
    getCountryRelationship(complianceCountry.cyId, targetCountry.cyId),
    resolveCountryGroupEvidence(complianceCountry.cyId, targetCountry.cyId, ctx.screeningDate),
    ctx.eccn ? getCommerceControlListEntries(ctx.eccn, targetCountry.cyId) : Promise.resolve([]),
  ]);

  const evidence: Record<string, unknown> = {
    complianceCyId: complianceCountry.cyId,
    targetCyId: targetCountry.cyId,
    countryGroupEvidence: groupEvidence,
    ...(ctx.eccn ? { cclMatches: cclEntries } : {}),
  };

  if (!relationship) {
    return {
      ...base,
      result: "CLEAR",
      reason: "NO_DIRECT_COUNTRY_PAIR_RULE",
      evidence,
    };
  }

  evidence.cycySeq = relationship.cycySeq;
  evidence.nationalSanction = relationship.cycyIndNationalSanction === "Y";
  evidence.euSanction = relationship.cycyIndEuSanction === "Y";
  evidence.unSanction = relationship.cycyIndUnSanction === "Y";

  const isEmbargoed = relationship.cycyIndEmbargoed === "Y";
  return {
    ...base,
    result: isEmbargoed ? "HIT" : "CLEAR",
    reason: isEmbargoed ? "DIRECT_COUNTRY_PAIR_EMBARGOED" : "DIRECT_COUNTRY_PAIR_CLEAR",
    ruleId: String(relationship.cycySeq),
    evidence,
  };
}
