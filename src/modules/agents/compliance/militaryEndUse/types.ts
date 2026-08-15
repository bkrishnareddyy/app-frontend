// Military End-Use / End-User Screening -- shared types.
//
// Two independent checks, both surfaced under this module (distinct finding
// categories, matching the spec):
//   1. Military end-use keyword check -- stated end-use text screened against
//      ComplianceKeywordRule rows (category MILITARY_END_USE).
//   2. Military end-user entity check -- transaction party names fuzzy-
//      matched against ScreeningEntity rows sourced from BIS's Military End
//      User (MEU) List (sourceList = "MEU_LIST").
// Neither check may resolve to CLEAR when its underlying reference data is
// unloaded/empty -- that must always report SKIPPED instead.

export type MilitaryEndUseCheckKind = "MILITARY_END_USE" | "MILITARY_END_USER";
export type MilitaryEndUseScreeningStatus = "CLEAR" | "HIT" | "REVIEW_REQUIRED" | "PARTIAL" | "SKIPPED" | "ERROR";

export interface MilitaryEndUseScreeningInput {
  accountId: string;
  shipmentId: string;
  /** Stated end-use text for the shipment, e.g. from an end-use statement/certificate. */
  endUseStatement?: string | null;
  /** Names checked against the Military End User (MEU) List -- exporter, supplier, importer/consignee. */
  entityNames: Array<{ role: string; name: string }>;
  screeningDate: Date;
}

export interface MilitaryEndUseKeywordHit {
  kind: "MILITARY_END_USE";
  matchedPhrase: string;
  citation: string | null;
  severity: string;
  reason: string;
}

export interface MilitaryEndUserEntityHit {
  kind: "MILITARY_END_USER";
  role: string;
  targetName: string;
  matchedEntityName: string;
  matchScore: number;
  matchStatus: "FLAGGED" | "BLOCKED";
  entityId: string;
  programCodes: string[];
  reason: string;
}

export type MilitaryEndUseHit = MilitaryEndUseKeywordHit | MilitaryEndUserEntityHit;

export interface MilitaryEndUseSkip {
  kind: MilitaryEndUseCheckKind;
  reason: string;
  role?: string;
}

export interface MilitaryEndUseError {
  kind: MilitaryEndUseCheckKind;
  code: string;
  message: string;
}

export interface MilitaryEndUseScreeningResult {
  status: MilitaryEndUseScreeningStatus;
  hits: MilitaryEndUseHit[];
  skipped: MilitaryEndUseSkip[];
  errors: MilitaryEndUseError[];
  militaryEndUseChecksRun: number;
  militaryEndUserChecksRun: number;
}
