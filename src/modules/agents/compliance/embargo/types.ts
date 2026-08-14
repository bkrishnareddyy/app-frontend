// Country Embargo Screening -- shared types.
//
// D = Destination, O = Origin (preserved throughout screening + audit per
// CountryEmbargoScreening_Prompt.md section 9/38).

export type ScreeningLevel = "TRANSACTION" | "PARTY" | "LINE";
export type EmbargoDirection = "D" | "O";
export type EmbargoMatcherName = "PRIVATE" | "US" | "GENERIC" | "STANDARD";
export type EmbargoCheckOutcome = "HIT" | "CLEAR" | "SKIPPED" | "ERROR";
export type ScreeningStatus = "CLEAR" | "HIT" | "PARTIAL" | "SKIPPED" | "ERROR";
export type AuditResultCode = "P" | "F";

/** Maps the source "subscriber" screening/audit configuration onto the Account tenant boundary. */
export interface AccountEmbargoConfig {
  embargoScreeningEnabled: boolean;
  privateEmbargoEnabled: boolean;
  serverScreeningEnabled: boolean;
  genericExportLdEnabled: boolean;
  audited: boolean;
  emailAlertEnabled: boolean;
  generalAuditLogEnabled: boolean;
}

export interface EmbargoParty {
  partyId: string;
  partyType: string;
  country?: string | null;
  userDefined?: string | null;
  militaryEndUse?: boolean;
  /** True when this party is the transaction's SHIP_TO party (section 11). */
  isShipTo?: boolean;
}

export interface EmbargoLineItem {
  lineItemId: string;
  lineNumber: number;
  /** Pipe-delimited classification string, e.g. "HTS|8501.10|CCL|3A001|SCHB|8501.10.0000". */
  classification?: string | null;
  eccn?: string | null;
  countryOfOrigin?: string | null;
  /** Line-level destination party, if the line has its own destination distinct from the transaction. */
  destinationParty?: EmbargoParty | null;
}

export interface CountryEmbargoScreeningInput {
  accountId: string;
  shipmentId: string;
  transactionId?: string;
  correlationId?: string;

  /** Compliance / ship-from country. */
  shipFromCountry: string;
  /** Transaction-level ship-to country, if known. */
  shipToCountry?: string | null;

  parties?: EmbargoParty[];
  lineItems?: EmbargoLineItem[];

  screeningDate: Date;
  accountConfig: AccountEmbargoConfig;

  /** Explicit per-invocation disable, independent of account configuration. */
  embargoScreening?: boolean;
}

export interface EmbargoCheckContext {
  accountId: string;
  shipmentId: string;
  transactionId?: string;
  partyId?: string;
  lineItemId?: string;
  userDefined?: string;

  screeningLevel: ScreeningLevel;

  complianceCountry: string;
  targetCountry: string;

  type: EmbargoDirection;

  eccn?: string;
  militaryEndUse?: boolean;

  screeningDate: Date;

  accountConfig: AccountEmbargoConfig;
}

export interface EmbargoCheckResult {
  result: EmbargoCheckOutcome;

  complianceCountry: string;
  screenedCountry: string;

  screeningLevel: ScreeningLevel;
  type: EmbargoDirection;

  matcher: EmbargoMatcherName;

  eccn?: string;
  militaryEndUse?: boolean;

  ruleId?: string;
  reason?: string;
  evidence?: Record<string, unknown>;

  context: EmbargoCheckContext;
}

export interface CountryEmbargoHit {
  accountId: string;
  shipmentId: string;
  transactionId?: string;

  partyId?: string;
  lineItemId?: string;
  userDefined?: string;

  screeningLevel: ScreeningLevel;
  type: EmbargoDirection;

  complianceCountry: string;
  country: string;

  embargo: "Y";

  eccn?: string;
  militaryEndUse?: boolean;

  matcher: EmbargoMatcherName;
  ruleId?: string;

  reason: string;
  evidence?: Record<string, unknown>;
}

export interface EmbargoScreeningSkip {
  reason: string;
  screeningLevel?: ScreeningLevel;
  partyId?: string;
  lineItemId?: string;
}

export interface EmbargoScreeningError {
  code: string;
  message: string;
}

export interface CountryEmbargoScreeningResult {
  status: ScreeningStatus;
  hits: CountryEmbargoHit[];
  checks: EmbargoCheckResult[];
  skippedChecks: EmbargoScreeningSkip[];
  errors: EmbargoScreeningError[];
  audit?: {
    usageId?: string;
    headerCreated: boolean;
    detailedLinesCreated: number;
  };
}

export interface ParsedClassification {
  hts?: string;
  eccn?: string;
  scheduleB?: string;
}
