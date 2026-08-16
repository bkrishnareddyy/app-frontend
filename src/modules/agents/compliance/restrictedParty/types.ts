// Restricted / Denied-Party Screening -- shared types.
//
// Screens a name (and, independently, a contact name) against ScreeningEntity
// rows sourced from OFAC SDN, BIS DPL, and the other denial-order lists not
// already owned by endUser/forcedLabor/militaryEndUse (sourceList IN "SDN",
// "CONSOLIDATED_NON_SDN", "DPL", "ISN", "SSI", "FSE", "PLC", "NS_MBS"), plus
// an independent red-flag word scan against ComplianceKeywordRule rows
// (category "RESTRICTED_PARTY_RED_FLAG"). No reference data loaded must
// resolve to SKIPPED, never CLEAR. A party-name pass and a contact-name pass
// never share candidate accumulation -- each is its own independent result.

export type RestrictedPartyScreeningStatus = "CLEAR" | "HIT" | "REVIEW_REQUIRED" | "PARTIAL" | "SKIPPED" | "ERROR";

export type RestrictedPartyPassType = "PARTY_NAME" | "CONTACT_NAME";

export type RestrictedPartyMatchMethod = "EXACT" | "RAW_WORD" | "METAPHONE" | "DOUBLE_METAPHONE" | "COMBINED";

export type RestrictedPartyScreeningSource = "PARTY_MASTER" | "SHIPMENT" | "LINE" | "PUBLIC_API" | "COPILOT" | "MANUAL";

/** The identity actually being screened -- richer than EmbargoParty (which lacks address/contact). */
export interface RestrictedPartyIdentity {
  name: string;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  contactName?: string | null;
}

export interface RestrictedPartyScreeningOptions {
  /** Minimum fuzzy-match score (0-100) for a candidate to count as a HIT-tier match. Below this but >= the fixed review floor is REVIEW_REQUIRED-tier. Default DEFAULT_NAME_THRESHOLD. */
  nameThreshold?: number;
  /** When set, a separate score gate on the candidate's address; a name match whose address falls short is downgraded a tier, never discarded. */
  addressThreshold?: number;
  /** When true, a match whose country doesn't align with the screened country is downgraded a tier (evidence retained, never discarded). */
  countryMatchRequired?: boolean;
  /** When false, the red-flag word scan is skipped entirely for this screening. Default true. */
  redFlagCheckEnabled?: boolean;
}

export interface RestrictedPartyScreeningInput extends RestrictedPartyScreeningOptions {
  accountId: string;
  source: RestrictedPartyScreeningSource;
  shipmentId?: string | null;
  lineItemId?: string | null;
  partyId?: string | null;
  externalReference?: string | null;
  identity: RestrictedPartyIdentity;
  /** Groups every pass produced by one logical invocation. Generated if omitted. */
  correlationId?: string;
  screeningDate?: Date;
}

export interface RestrictedPartyMatchCandidate {
  sequence: number;
  screeningEntityId: string;
  matchedName: string;
  matchedAddress: string | null;
  nameScore: number;
  addressScore: number | null;
  matchMethod: RestrictedPartyMatchMethod;
  countryMatch: boolean | null;
  sourceList: string;
  entityType: string;
  programCodes: string[];
  tier: "HIT" | "REVIEW_REQUIRED";
  suppressedByApprovedParty: boolean;
  suppressingDispositionId: string | null;
}

export interface RestrictedPartyRedFlagHitCandidate {
  keywordRuleId: string | null;
  matchedWord: string;
}

export interface RestrictedPartyPassOutcome {
  passType: RestrictedPartyPassType;
  screenedName: string;
  screenedAddress: string | null;
  screenedCity: string | null;
  screenedCountry: string | null;
  nameThreshold: number;
  addressThreshold: number | null;
  countryMatchRequired: boolean;
  redFlagCheckEnabled: boolean;
  status: RestrictedPartyScreeningStatus;
  matches: RestrictedPartyMatchCandidate[];
  redFlagHits: RestrictedPartyRedFlagHitCandidate[];
  errorCode: string | null;
  errorMessage: string | null;
  screeningInputHash: string;
  screeningDurationMs: number;
}

export interface RestrictedPartyScreeningRunResult {
  correlationId: string;
  passes: RestrictedPartyPassOutcome[];
}

export const DEFAULT_NAME_THRESHOLD = 80;
/** Fixed floor below which a candidate is not worth surfacing at all, regardless of nameThreshold. */
export const REVIEW_FLOOR_SCORE = 50;
