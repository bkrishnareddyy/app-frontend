// End-Use Screening -- shared types.
//
// One deterministic check: the shipment's stated end-use text (captured as a
// Fact, field "endUseStatement") is screened against ComplianceKeywordRule
// rows for restricted-end-use categories (nuclear, missile, chemical/
// biological, rocket/UAV). No stated end-use text or no published reference
// data must both resolve to SKIPPED, never CLEAR.

export type EndUseRestrictedCategory =
  | "END_USE_NUCLEAR"
  | "END_USE_MISSILE"
  | "END_USE_CHEM_BIO"
  | "END_USE_ROCKET_UAV";

export type EndUseScreeningStatus = "CLEAR" | "HIT" | "REVIEW_REQUIRED" | "PARTIAL" | "SKIPPED" | "ERROR";

export interface EndUseScreeningInput {
  accountId: string;
  shipmentId: string;
  /** Stated end-use text for the shipment, e.g. from an end-use statement/certificate. */
  endUseStatement?: string | null;
  screeningDate: Date;
}

export interface EndUseHit {
  category: EndUseRestrictedCategory;
  matchedPhrase: string;
  citation: string | null;
  severity: string;
  reason: string;
}

export interface EndUseSkip {
  reason: string;
}

export interface EndUseError {
  code: string;
  message: string;
}

export interface EndUseScreeningResult {
  status: EndUseScreeningStatus;
  hits: EndUseHit[];
  skipped: EndUseSkip[];
  errors: EndUseError[];
  checksRun: number;
}
