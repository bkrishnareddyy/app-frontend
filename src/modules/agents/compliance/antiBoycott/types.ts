// Anti-Boycott Screening -- shared types.
//
// Two independent checks:
//   1. Country check -- destination country's Country.cyIndBoycotted flag
//      (existing, previously-unused column; no schema change).
//   2. Document-language check -- transaction document/narrative text
//      screened against ComplianceKeywordRule rows for boycott-request
//      language (category ANTI_BOYCOTT_REQUEST).
// Neither check may resolve to CLEAR when its underlying data is
// unavailable/unloaded -- that must always report SKIPPED instead.

export type AntiBoycottCheckKind = "COUNTRY" | "DOCUMENT_LANGUAGE";
export type AntiBoycottScreeningStatus = "CLEAR" | "HIT" | "REVIEW_REQUIRED" | "PARTIAL" | "SKIPPED" | "ERROR";

export interface AntiBoycottScreeningInput {
  accountId: string;
  shipmentId: string;
  destinationCountry?: string | null;
  /** Free-text transaction document/narrative content, e.g. an LC or purchase order. */
  documentNarrativeText?: string | null;
  screeningDate: Date;
}

export interface AntiBoycottCountryHit {
  kind: "COUNTRY";
  country: string;
  reason: string;
}

export interface AntiBoycottDocumentHit {
  kind: "DOCUMENT_LANGUAGE";
  matchedPhrase: string;
  citation: string | null;
  severity: string;
  reason: string;
}

export type AntiBoycottHit = AntiBoycottCountryHit | AntiBoycottDocumentHit;

export interface AntiBoycottSkip {
  kind: AntiBoycottCheckKind;
  reason: string;
}

export interface AntiBoycottError {
  kind: AntiBoycottCheckKind;
  code: string;
  message: string;
}

export interface AntiBoycottScreeningResult {
  status: AntiBoycottScreeningStatus;
  hits: AntiBoycottHit[];
  skipped: AntiBoycottSkip[];
  errors: AntiBoycottError[];
  countryChecksRun: number;
  documentChecksRun: number;
}
