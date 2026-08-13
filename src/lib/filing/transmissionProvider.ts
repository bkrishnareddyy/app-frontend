/**
 * CustomsFilingTransmissionProvider interface and supporting types.
 *
 * Implement this interface to plug in real CBP ABI credentials without any
 * other code changes. The only active implementation is MockCustomsTransmissionProvider
 * (in src/lib/providers/index.ts) until ABI filer credentials are available.
 *
 * RealAceProvider is a stub: adding the HTTP calls to the CBP ABI endpoint is the
 * only remaining step once credentials exist.
 */

// ── CATAIR-aligned ABI payload ─────────────────────────────────────────────────

/**
 * Payload structure for ACE/ABI submission, aligned with the CATAIR transaction
 * set. The 7501 field mapping in form7501.ts maps to these fields.
 */
export interface AbiPayload {
  filingId: string;
  entryNumber: string;
  entryType: string;
  portOfEntry: string;
  importerCbpNumber: string;
  bondNumber: string;
  countryOfExport: string;
  carrier: string;
  totalEnteredValue: number;
  totalDuty: number;
  lineItems: Array<{
    lineNumber: number;
    htsCode: string;
    description: string;
    quantity: number;
    enteredValue: number;
    dutyRate: number;
    dutyAmount: number;
    countryOfOrigin: string;
  }>;
  /** ISO 8601 timestamp when this payload was built */
  builtAt: string;
}

export interface TransmissionResult {
  referenceNumber: string;
  status: "ACCEPTED" | "REJECTED" | "PENDING_REVIEW";
  responseCode: string;
  message: string;
  transmittedAt: string;
}

export interface FilingStatusUpdate {
  referenceNumber: string;
  status: "ACCEPTED" | "REJECTED" | "RELEASED" | "LIQUIDATED" | "PENDING" | "UNDER_REVIEW";
  updatedAt: string;
  notes?: string;
}

export interface AcknowledgmentResult {
  referenceNumber: string;
  accepted: boolean;
  responseCode: string;
  rejectionReasons?: string[];
  /** Unmodified raw acknowledgment string from CBP for audit purposes. */
  raw: string;
}

// ── Provider interface ─────────────────────────────────────────────────────────

/**
 * Plug-in interface for ACE/ABI customs transmission.
 * Implementations: MockCustomsTransmissionProvider (active), RealAceProvider (stub).
 */
export interface CustomsFilingTransmissionProvider {
  transmit(payload: AbiPayload): Promise<TransmissionResult>;
  getStatus(referenceNumber: string): Promise<FilingStatusUpdate>;
  parseAcknowledgment(raw: string): AcknowledgmentResult;
}

// ── Real ACE provider stub ─────────────────────────────────────────────────────

/**
 * Stub for the real CBP ACE/ABI provider.
 *
 * Structure: credentials are read from process.env.CBP_ABI_*. Adding real
 * HTTP calls to the CBP ABI endpoint is the only remaining step once
 * credentials are available. Do not activate in production until that step
 * is complete and tested against the CBP ABI sandbox.
 *
 * Not instantiated anywhere in the active code path — the health check will
 * surface the mock provider as active until this is wired up.
 */
export class RealAceProvider implements CustomsFilingTransmissionProvider {
  private readonly filerCode: string;
  private readonly filerPassword: string;
  private readonly baseUrl: string;

  constructor() {
    this.filerCode = process.env.CBP_ABI_FILER_CODE ?? "";
    this.filerPassword = process.env.CBP_ABI_FILER_PASSWORD ?? "";
    this.baseUrl = process.env.CBP_ABI_BASE_URL ?? "https://ace.cbp.dhs.gov/abi";
  }

  private assertCredentials(): void {
    if (!this.filerCode || !this.filerPassword) {
      throw new Error(
        "CBP_ABI_FILER_CODE and CBP_ABI_FILER_PASSWORD must be set to use RealAceProvider."
      );
    }
  }

  async transmit(_payload: AbiPayload): Promise<TransmissionResult> {
    this.assertCredentials();
    // TODO: POST to this.baseUrl using CBP ABI CATAIR format with this.filerCode + this.filerPassword
    throw new Error(
      "RealAceProvider.transmit is not yet implemented. " +
        `Base URL: ${this.baseUrl}. Add CBP ABI HTTP calls here once filer credentials are on file.`
    );
  }

  async getStatus(_referenceNumber: string): Promise<FilingStatusUpdate> {
    this.assertCredentials();
    // TODO: GET /status/{referenceNumber} from CBP ABI
    throw new Error("RealAceProvider.getStatus is not yet implemented.");
  }

  parseAcknowledgment(raw: string): AcknowledgmentResult {
    // TODO: parse CATAIR 999 functional acknowledgment or proprietary CBP response format
    throw new Error(
      `RealAceProvider.parseAcknowledgment is not yet implemented. Raw input length: ${raw.length}.`
    );
  }
}
