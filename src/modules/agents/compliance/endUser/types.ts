// End-User Screening -- shared types.
//
// One deterministic check: transaction party names are fuzzy-matched against
// ScreeningEntity rows sourced from the BIS Entity List / Unverified List
// (sourceList IN "ENTITY_LIST", "UNVERIFIED" -- already ingested by
// bisCslIngestionService.ts, consolidated here rather than duplicated).
// No reference data loaded must resolve to SKIPPED, never CLEAR.

export type EndUserScreeningStatus = "CLEAR" | "HIT" | "REVIEW_REQUIRED" | "PARTIAL" | "SKIPPED" | "ERROR";

export interface EndUserScreeningInput {
  accountId: string;
  shipmentId: string;
  /** Names checked against the BIS Entity List / Unverified List -- exporter, supplier, importer/consignee. */
  entityNames: Array<{ role: string; name: string }>;
  screeningDate: Date;
}

export interface EndUserHit {
  role: string;
  targetName: string;
  matchedEntityName: string;
  matchScore: number;
  matchStatus: "FLAGGED" | "BLOCKED";
  entityId: string;
  sourceList: string;
  programCodes: string[];
  reason: string;
}

export interface EndUserSkip {
  reason: string;
  role?: string;
}

export interface EndUserError {
  code: string;
  message: string;
}

export interface EndUserScreeningResult {
  status: EndUserScreeningStatus;
  hits: EndUserHit[];
  skipped: EndUserSkip[];
  errors: EndUserError[];
  checksRun: number;
}
