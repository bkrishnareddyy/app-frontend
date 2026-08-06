export interface ProviderMetadata {
  providerName: string;
  datasetVersion: string;
  retrievedAt: string;
  effectiveDateRange?: { start: string; end?: string };
  completenessStatus: "COMPLETE" | "PARTIAL" | "DATA_UNAVAILABLE";
  sourceIdentifiers?: string[];
}

export interface HtsCandidate {
  htsCode10: string;
  description: string;
  chapterNumber: string;
  headingNumber: string;
  generalDutyRate: string;
  specialRatePrograms?: Record<string, string>;
  section301Applicable: boolean;
  section301AdditionalRate?: number;
  section232Applicable: boolean;
  section232AdditionalRate?: number;
}

export interface HtsDataProvider {
  searchHts(query: string, chapter?: string): Promise<{ candidates: HtsCandidate[]; metadata: ProviderMetadata }>;
  getByCode(code: string): Promise<{ candidate: HtsCandidate | null; metadata: ProviderMetadata }>;
}

export interface CustomsRuling {
  rulingNumber: string;
  title: string;
  subject: string;
  publicationDate: string;
  effectiveDate: string;
  htsCodeCited: string;
  summary: string;
  url?: string;
}

export interface CustomsRulingsProvider {
  searchRulings(htsCodeOrKeyword: string): Promise<{ rulings: CustomsRuling[]; metadata: ProviderMetadata }>;
}

export interface CustomsTransmissionResult {
  submissionId: string;
  entryNumber: string;
  status: "ACCEPTED" | "REJECTED" | "PENDING_REVIEW";
  responseCode: string;
  message: string;
  metadata: ProviderMetadata;
}

export interface CustomsTransmissionProvider {
  /** Returns true if this provider is a mock/sandbox — never suitable for production. */
  isMockProvider(): boolean;
  submitEntry(entryData: Record<string, unknown>): Promise<CustomsTransmissionResult>;
  getStatus(submissionId: string): Promise<CustomsTransmissionResult>;
}

// -----------------------------------------------------------------------------
// PRODUCTION SAFETY GUARD (QPR-001 req 3)
// -----------------------------------------------------------------------------

/**
 * Throws a 503 error if the provider is a mock and the runtime is production.
 * Call this before any real transmission attempt.
 */
export function assertProductionProvider(provider: CustomsTransmissionProvider): void {
  if (provider.isMockProvider() && process.env.NODE_ENV === "production") {
    throw new Error(
      "PROVIDER_UNAVAILABLE: Production environment requires a real customs transmission provider. " +
        "Configure ACE_PROVIDER_CLASS in your environment and restart."
    );
  }
}

// -----------------------------------------------------------------------------
// MOCK / SANDBOX PROVIDER IMPLEMENTATIONS (Explicitly Named)
// -----------------------------------------------------------------------------

export class MockCustomsTransmissionProvider implements CustomsTransmissionProvider {
  isMockProvider(): boolean {
    return true;
  }

  async submitEntry(entryData: Record<string, unknown>): Promise<CustomsTransmissionResult> {
    return {
      submissionId: `MOCK_SUB_${Date.now()}`,
      entryNumber: (entryData.entryNumber as string) || "5901-26-000000",
      status: "ACCEPTED",
      responseCode: "ACK_SANDBOX",
      message: "[MOCK PROVIDER] Entry transmission simulated successfully. Not connected to real CBP ACE API.",
      metadata: {
        providerName: "MockCustomsTransmissionProvider (Sandbox)",
        datasetVersion: "ACE-ABI-SANDBOX-2026.1",
        retrievedAt: new Date().toISOString(),
        completenessStatus: "PARTIAL",
      },
    };
  }

  async getStatus(submissionId: string): Promise<CustomsTransmissionResult> {
    return {
      submissionId,
      entryNumber: "5901-26-000000",
      status: "ACCEPTED",
      responseCode: "ACK_SANDBOX",
      message: "[MOCK PROVIDER] Status query return simulated.",
      metadata: {
        providerName: "MockCustomsTransmissionProvider (Sandbox)",
        datasetVersion: "ACE-ABI-SANDBOX-2026.1",
        retrievedAt: new Date().toISOString(),
        completenessStatus: "PARTIAL",
      },
    };
  }
}
