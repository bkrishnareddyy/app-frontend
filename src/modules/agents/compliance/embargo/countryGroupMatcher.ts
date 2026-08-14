// Country Embargo Screening -- country-group fallback.
//
// KNOWN GAP (see final implementation report): the supplied DDL
// (CountryEmbargoScreening_Tables.sql) defines country_groups /
// country_group_maps / compliance_country_groups / cy_ccg_maps and their
// foreign keys, but no supplied source material defines the exact join
// between "compliance country is a member of compliance-country-group X"
// / "target country is a member of country-group Y" and an embargo Y/N
// determination -- the Java matcher that encodes that precedence
// (com.tps.ece.migrated.em.EmbargoScreening) was not provided. Per
// CountryEmbargoScreening_Prompt.md section 23/57 ("do not guess missing
// rule precedence" / "do not hardcode group memberships"), this module
// resolves and returns group-membership EVIDENCE only. It never asserts a
// HIT or CLEAR from group membership alone -- callers must treat the
// direct country_by_country_maps outcome (HIT / CLEAR / NO_DIRECT_RULE) as
// authoritative and surface this evidence for reviewer/audit transparency.
import {
  getCountryGroupMemberships,
  getComplianceCountryGroupMemberships,
} from "./embargoRepository";

export interface CountryGroupEvidence {
  complianceCountryGroupIds: string[];
  targetCountryGroupIds: string[];
  complianceCountryComplianceGroupIds: string[];
  capabilityGap: true;
  reason: string;
}

export async function resolveCountryGroupEvidence(
  complianceCountryId: string,
  targetCountryId: string,
  screeningDate: Date
): Promise<CountryGroupEvidence> {
  const [complianceGroups, targetGroups, complianceCcgMemberships] = await Promise.all([
    getCountryGroupMemberships([complianceCountryId], screeningDate),
    getCountryGroupMemberships([targetCountryId], screeningDate),
    getComplianceCountryGroupMemberships([complianceCountryId]),
  ]);

  return {
    complianceCountryGroupIds: complianceGroups.map((g) => g.groupId),
    targetCountryGroupIds: targetGroups.map((g) => g.groupId),
    complianceCountryComplianceGroupIds: complianceCcgMemberships.map((m) => m.complianceGroupId),
    capabilityGap: true,
    reason:
      "Country-group fallback determination is not implemented: the source business rule mapping group membership to an embargo Y/N outcome was not supplied. Group-membership evidence is provided for audit/reviewer transparency only.",
  };
}
