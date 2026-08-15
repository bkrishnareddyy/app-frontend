// UFLPA / Forced Labor Screening -- shared types.
//
// Two independent, deterministic checks, both surfaced under this module:
//   1. Country/region rebuttable-presumption check -- origin country/region
//      matches an EmbargoRule row whose regime names UFLPA Forced Labor
//      (pre-existing logic, consolidated here rather than duplicated).
//   2. Entity-list check -- exporter/supplier/manufacturer name fuzzy-matched
//      against ScreeningEntity rows sourced from the CBP UFLPA Entity List
//      (sourceList = "UFLPA_ENTITY_LIST").
// Neither check may resolve to CLEAR when its underlying reference data is
// unloaded/empty -- that must always report SKIPPED instead.

export type ForcedLaborCheckKind = "COUNTRY_REGION" | "ENTITY_LIST";
export type ForcedLaborCheckOutcome = "HIT" | "CLEAR" | "SKIPPED" | "ERROR";
export type ForcedLaborScreeningStatus = "CLEAR" | "HIT" | "REVIEW_REQUIRED" | "PARTIAL" | "SKIPPED" | "ERROR";

export interface ForcedLaborLineItem {
  lineNumber: number;
  countryOfOrigin?: string | null;
}

export interface ForcedLaborScreeningInput {
  accountId: string;
  shipmentId: string;
  lineItems: ForcedLaborLineItem[];
  /** Names checked against the UFLPA Entity List -- exporter, supplier/manufacturer. */
  entityNames: Array<{ role: string; name: string }>;
  screeningDate: Date;
}

export interface ForcedLaborCountryHit {
  kind: "COUNTRY_REGION";
  lineNumber: number;
  countryOfOrigin: string;
  ruleId: string;
  regime: string;
  countryName: string;
  reason: string;
}

export interface ForcedLaborEntityHit {
  kind: "ENTITY_LIST";
  role: string;
  targetName: string;
  matchedEntityName: string;
  matchScore: number;
  matchStatus: "FLAGGED" | "BLOCKED";
  entityId: string;
  programCodes: string[];
  reason: string;
}

export type ForcedLaborHit = ForcedLaborCountryHit | ForcedLaborEntityHit;

export interface ForcedLaborSkip {
  kind: ForcedLaborCheckKind;
  reason: string;
  lineNumber?: number;
  role?: string;
}

export interface ForcedLaborError {
  kind: ForcedLaborCheckKind;
  code: string;
  message: string;
}

export interface ForcedLaborScreeningResult {
  status: ForcedLaborScreeningStatus;
  hits: ForcedLaborHit[];
  skipped: ForcedLaborSkip[];
  errors: ForcedLaborError[];
  countryRegionChecksRun: number;
  entityListChecksRun: number;
}
