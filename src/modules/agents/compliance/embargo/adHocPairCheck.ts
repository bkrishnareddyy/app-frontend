// Country Embargo Screening -- ad-hoc, walk-up country-pair check.
//
// The shipment-oriented orchestrator (evaluateCountryPair/countryPairEvaluator.ts)
// is built around EmbargoCheckContext, which requires a shipment. This is a
// separate, small pure function for the standalone "type in two countries"
// screen -- built on the same repository primitives (resolveCountries,
// getCountryRelationship), never duplicating or reinventing the matching
// logic. No row / no truthy flags => empty findings (clear), never an
// invented message.
import { resolveCountries, getCountryRelationship } from "./embargoRepository";

export type AdHocEmbargoFindingKind = "NATIONAL_SANCTION" | "EMBARGOED" | "EU_SANCTION" | "UN_SANCTION";

export interface AdHocEmbargoFinding {
  kind: AdHocEmbargoFindingKind;
  message: string;
}

export interface AdHocEmbargoCountry {
  code: string;
  name: string;
}

export interface AdHocEmbargoResult {
  complianceCountry: AdHocEmbargoCountry | null;
  targetCountry: AdHocEmbargoCountry | null;
  findings: AdHocEmbargoFinding[];
}

export async function checkCountryPair(
  complianceCountryInput: string,
  targetCountryInput: string
): Promise<AdHocEmbargoResult> {
  const resolved = await resolveCountries([complianceCountryInput, targetCountryInput]);
  const complianceRow = resolved.get(complianceCountryInput) ?? null;
  const targetRow = resolved.get(targetCountryInput) ?? null;

  const complianceCountry: AdHocEmbargoCountry | null = complianceRow
    ? { code: complianceRow.cyId, name: complianceRow.cyShortName ?? complianceRow.cyName ?? complianceRow.cyId }
    : null;
  const targetCountry: AdHocEmbargoCountry | null = targetRow
    ? { code: targetRow.cyId, name: targetRow.cyShortName ?? targetRow.cyName ?? targetRow.cyId }
    : null;

  if (!complianceRow || !targetRow) {
    return { complianceCountry, targetCountry, findings: [] };
  }

  const relationship = await getCountryRelationship(complianceRow.cyId, targetRow.cyId);
  if (!relationship) {
    return { complianceCountry, targetCountry, findings: [] };
  }

  const findings: AdHocEmbargoFinding[] = [];
  if (relationship.cycyIndNationalSanction) {
    findings.push({ kind: "NATIONAL_SANCTION", message: "This country is on a user-specified watch list." });
  }
  if (relationship.cycyIndEmbargoed) {
    findings.push({
      kind: "EMBARGOED",
      message: "Country is embargoed. Individual Export License is required to ship to this country.",
    });
  }
  if (relationship.cycyIndEuSanction) {
    findings.push({ kind: "EU_SANCTION", message: "This country is on an EU sanctions list." });
  }
  if (relationship.cycyIndUnSanction) {
    findings.push({ kind: "UN_SANCTION", message: "This country is on a UN sanctions list." });
  }

  return { complianceCountry, targetCountry, findings };
}
