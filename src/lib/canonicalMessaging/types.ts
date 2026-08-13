/**
 * Canonical filing message types.
 *
 * These mirror schemas/customs-filing/*\/1.0.0.json exactly. The JSON Schema
 * files are the source of truth for validation (see schemaValidator.ts);
 * these types exist so application code gets compile-time checking against
 * the same shape, not because the type is authoritative on its own.
 */

export type FilingMessageAction =
  | "SUBMIT"
  | "AMENDMENT"
  | "CANCELLATION"
  | "RESUBMIT"
  | "STATUS_INQUIRY";

export type CanonicalFilingStatus =
  | "ACCEPTED"
  | "REJECTED"
  | "NEEDS_INFO"
  | "RELEASED"
  | "CANCELLED"
  | "ERROR";

export interface CanonicalMessageHeader {
  messageId: string;
  filingId: string;
  /** Response messages only. Equals the messageId of the request being answered. */
  correlationId?: string;
  /** AMENDMENT / CANCELLATION / RESUBMIT / STATUS_INQUIRY only. */
  priorMessageId?: string;
  messageName: string;
  direction: "OUTBOUND" | "INBOUND";
  customer: { accountId: string; accountName?: string };
  /** Third-party procedure code -- resolved via resolveMessageContext(), never hardcoded. */
  procedure: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  authority?: string;
  /** ISO 8601. */
  dateTime: string;
  schemaVersion: string;
  senderSystem: string;
  priority?: number;
  retryCount?: number;
  extensions?: Record<string, unknown>;
}

export interface CanonicalParty {
  name?: string;
  country?: string;
  taxId?: string;
}

export interface CanonicalLineItem {
  lineNumber: number;
  description: string;
  /** Universal WCO Harmonized System code -- same value regardless of destination. */
  hsCode6: string;
  /** The destination country's national tariff-code tail. Filled in by the third-party renderer, not by Qubere. */
  nationalTariffSuffix?: string;
  originCountry: string;
  quantity: { value: number; uom: string };
  unitPrice: number;
  totalValue: number;
  eccnCode?: string;
}

export interface CanonicalCustomsDeclaration {
  declarationId: string;
  /** Internal CBP entry-type code from entryType.ts, e.g. "01". Not a country-specific procedure code. */
  entryType: string;
  importer?: CanonicalParty;
  exporter?: CanonicalParty;
  filer?: CanonicalParty;
  transport?: {
    mode?: string;
    carrierName?: string;
    vessel?: string;
    portOfEntry?: string;
    arrivalDate?: string;
  };
  currency?: string;
  incoterm?: string;
  lineItems: CanonicalLineItem[];
  valuation?: {
    method: string;
    totalValue: number;
    adjustments?: Array<{ type: string; amount: number }>;
  };
  totals: {
    customsValue: number;
    dutyAmount?: number;
    feesAmount?: number;
  };
  compliance?: {
    screeningCleared?: boolean;
    licensesRequired?: string[];
    /** Country/program-specific flags, e.g. "uflpaCleared" for a US-bound entry -- named per destination, not hardcoded here. */
    complianceFlags?: Record<string, boolean>;
  };
  evidence?: {
    classificationRationale?: string;
    originCriterion?: string;
    sourceDocumentIds?: string[];
  };
  extensions?: Record<string, unknown>;
}

export interface CanonicalFilingRequestData {
  declaration: CanonicalCustomsDeclaration;
}

export interface CanonicalFilingResponseData {
  status: CanonicalFilingStatus;
  authorityReference?: string;
  humanMessage?: string;
  rawResponsePayload?: unknown;
  extensions?: Record<string, unknown>;
}

export interface CanonicalMessage<T> {
  header: CanonicalMessageHeader;
  data: T;
}

export type CanonicalSchemaType =
  | "ENVELOPE_HEADER"
  | "FILING_REQUEST_DECLARATION"
  | "FILING_RESPONSE_DATA";
