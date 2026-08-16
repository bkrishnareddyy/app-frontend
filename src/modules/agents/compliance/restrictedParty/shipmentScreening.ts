// Restricted / Denied-Party Screening -- shipment-level aggregation.
//
// ComplianceAuditAgent needs one summary result per shipment, not the raw
// per-party/per-pass output runRestrictedPartyScreening returns. This walks
// every ShipmentParty via getShipmentPartiesForScreening (richer than
// EmbargoParty -- has address/contact), screens and persists each one, and
// aggregates to the same status/hits/skipped/errors shape every sibling
// screening module's result type uses. No shipment parties available must
// resolve to SKIPPED, never CLEAR.
import { getShipmentPartiesForScreening } from "./restrictedPartyRepository";
import { runRestrictedPartyScreening } from "./restrictedPartyScreening";
import { persistScreeningRun } from "./persistResult";
import type { RestrictedPartyPassType, RestrictedPartyScreeningStatus } from "./types";

const STATUS_SEVERITY: Record<RestrictedPartyScreeningStatus, number> = {
  HIT: 5,
  REVIEW_REQUIRED: 4,
  PARTIAL: 3,
  ERROR: 2,
  SKIPPED: 1,
  CLEAR: 0,
};

function worseStatus(a: RestrictedPartyScreeningStatus, b: RestrictedPartyScreeningStatus): RestrictedPartyScreeningStatus {
  return STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b;
}

export interface RestrictedPartyShipmentHit {
  role: string;
  partyName: string;
  matchedName: string;
  sourceList: string;
  nameScore: number;
  matchMethod: string;
  tier: "HIT" | "REVIEW_REQUIRED";
  passType: RestrictedPartyPassType;
  reason: string;
}

export interface RestrictedPartyShipmentRedFlagHit {
  role: string;
  partyName: string;
  matchedWord: string;
  passType: RestrictedPartyPassType;
  reason: string;
}

export interface RestrictedPartyShipmentSkip {
  role: string;
  reason: string;
}

export interface RestrictedPartyShipmentError {
  role: string;
  code: string;
  message: string;
}

export interface RestrictedPartyShipmentScreeningResult {
  status: RestrictedPartyScreeningStatus;
  hits: RestrictedPartyShipmentHit[];
  redFlagHits: RestrictedPartyShipmentRedFlagHit[];
  skipped: RestrictedPartyShipmentSkip[];
  errors: RestrictedPartyShipmentError[];
  partiesScreened: number;
}

export async function runRestrictedPartyScreeningForShipment(
  accountId: string,
  shipmentId: string
): Promise<RestrictedPartyShipmentScreeningResult> {
  const parties = await getShipmentPartiesForScreening(shipmentId);

  if (parties.length === 0) {
    return {
      status: "SKIPPED",
      hits: [],
      redFlagHits: [],
      skipped: [{ role: "ALL", reason: "No shipment parties are available to screen." }],
      errors: [],
      partiesScreened: 0,
    };
  }

  let overall: RestrictedPartyScreeningStatus = "CLEAR";
  const hits: RestrictedPartyShipmentHit[] = [];
  const redFlagHits: RestrictedPartyShipmentRedFlagHit[] = [];
  const skipped: RestrictedPartyShipmentSkip[] = [];
  const errors: RestrictedPartyShipmentError[] = [];

  for (const party of parties) {
    const input = {
      accountId,
      source: "SHIPMENT" as const,
      shipmentId,
      partyId: party.partyId,
      externalReference: party.shipmentPartyId,
      identity: {
        name: party.name,
        address: party.address,
        city: party.city,
        country: party.country,
        contactName: party.contactName,
      },
    };

    const runResult = await runRestrictedPartyScreening(input);
    await persistScreeningRun(input, runResult);

    for (const pass of runResult.passes) {
      overall = worseStatus(overall, pass.status);

      if (pass.status === "SKIPPED") {
        skipped.push({ role: party.role, reason: "No restricted-party reference data is loaded." });
      }
      if (pass.status === "ERROR" || pass.status === "PARTIAL") {
        if (pass.errorCode || pass.errorMessage) {
          errors.push({ role: party.role, code: pass.errorCode ?? "ERROR", message: pass.errorMessage ?? "Unknown error" });
        }
      }

      for (const m of pass.matches) {
        if (m.suppressedByApprovedParty) continue;
        if (m.tier === "HIT" || m.tier === "REVIEW_REQUIRED") {
          hits.push({
            role: party.role,
            partyName: party.name,
            matchedName: m.matchedName,
            sourceList: m.sourceList,
            nameScore: m.nameScore,
            matchMethod: m.matchMethod,
            tier: m.tier,
            passType: pass.passType,
            reason: `${party.role} "${party.name}" (${pass.passType === "CONTACT_NAME" ? "contact" : "party"} name) matches ${m.sourceList} entry "${m.matchedName}" at ${m.nameScore}% (${m.matchMethod}).`,
          });
        }
      }

      for (const rf of pass.redFlagHits) {
        redFlagHits.push({
          role: party.role,
          partyName: party.name,
          matchedWord: rf.matchedWord,
          passType: pass.passType,
          reason: `${party.role} "${party.name}" (${pass.passType === "CONTACT_NAME" ? "contact" : "party"} name) contains red-flag phrase "${rf.matchedWord}".`,
        });
      }
    }
  }

  return { status: overall, hits, redFlagHits, skipped, errors, partiesScreened: parties.length };
}
