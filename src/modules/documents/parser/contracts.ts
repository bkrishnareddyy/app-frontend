/**
 * Provider-neutral document parser contracts (Qubere parser contract v1).
 *
 * Nothing in this file may mention a specific vendor. Downstream Qubere code
 * depends on these types only, so a second parser provider can be introduced
 * without touching business logic. Vendor payload shapes live next to their
 * provider (see `ibm/doclingWire.ts`).
 *
 * Versioning: this contract is versioned independently of both the provider's
 * own wire contract and `QubereDocumentContextV1`. Bump QUBERE_PARSER_CONTRACT_VERSION
 * when the meaning of a field here changes.
 */

import { z } from "zod";

export const QUBERE_PARSER_CONTRACT_VERSION = "qubere.parser/1";

// ---------------------------------------------------------------------------
// Processing profiles
// ---------------------------------------------------------------------------

/**
 * Named Qubere processing profiles. These are Qubere concepts; each provider
 * maps them onto whatever options it actually supports and tells us which
 * options it could not honour (see `ParserSubmissionAck.unsupportedOptions`).
 */
export const PROCESSING_PROFILES = ["STANDARD", "OCR_FALLBACK", "FULL_PAGE_OCR"] as const;
export type ProcessingProfile = (typeof PROCESSING_PROFILES)[number];

export function isProcessingProfile(value: unknown): value is ProcessingProfile {
  return typeof value === "string" && (PROCESSING_PROFILES as readonly string[]).includes(value);
}

/** Why a processing run exists. Recorded on the run for audit. */
export const PROCESSING_REASONS = [
  "INITIAL",
  "MANUAL_REPROCESS",
  "OCR_RETRY",
  "QUALITY_RETRY",
  "PARSER_UPGRADE",
  "CONFIG_CHANGE",
] as const;
export type ProcessingReason = (typeof PROCESSING_REASONS)[number];

// ---------------------------------------------------------------------------
// Qubere-side processing run states
// ---------------------------------------------------------------------------

/**
 * The Qubere processing state machine. Provider status strings are translated
 * into these and never leak past a provider module.
 *
 * QUEUED -> SUBMITTED -> POLLING -> SUCCEEDED
 *                              \-> NEEDS_REVIEW
 *                              \-> FAILED (-> QUEUED when retryable)
 */
export const PROCESSING_RUN_STATES = [
  "QUEUED",
  "SUBMITTED",
  "POLLING",
  "SUCCEEDED",
  "NEEDS_REVIEW",
  "FAILED",
] as const;
export type ProcessingRunState = (typeof PROCESSING_RUN_STATES)[number];

/** Terminal states never transition again; a new run is created instead. */
export const TERMINAL_RUN_STATES: readonly ProcessingRunState[] = [
  "SUCCEEDED",
  "NEEDS_REVIEW",
] as const;

const LEGAL_TRANSITIONS: Readonly<Record<ProcessingRunState, readonly ProcessingRunState[]>> = {
  QUEUED: ["SUBMITTED", "FAILED"],
  SUBMITTED: ["POLLING", "SUCCEEDED", "NEEDS_REVIEW", "FAILED"],
  POLLING: ["POLLING", "SUCCEEDED", "NEEDS_REVIEW", "FAILED"],
  // A retryable failure goes back to QUEUED as the SAME run's next attempt.
  FAILED: ["QUEUED"],
  // Never mutate a historical accepted run. Reprocessing creates a new run.
  SUCCEEDED: [],
  NEEDS_REVIEW: [],
};

export function isLegalTransition(from: ProcessingRunState, to: ProcessingRunState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Structured error model
// ---------------------------------------------------------------------------

export const PARSER_ERROR_CODES = [
  // Intake-side
  "UNSUPPORTED_FILE_TYPE",
  "INVALID_FILE",
  "EMPTY_FILE",
  "FILE_TOO_LARGE",
  "PDF_ENCRYPTED",
  "PDF_CORRUPTED",
  "MALWARE_QUARANTINED",
  // Provider-side
  "PARSER_NOT_CONFIGURED",
  "PARSER_SUBMISSION_FAILED",
  "PARSER_TIMEOUT",
  "PARSER_PROVIDER_ERROR",
  "PARSER_RESULT_INVALID",
  "PARSER_RESULT_INCOMPLETE",
  // Qubere-side
  "ARTIFACT_STORAGE_FAILED",
  "SOURCE_FILE_UNAVAILABLE",
  "QUALITY_REVIEW_REQUIRED",
] as const;
export type ParserErrorCode = (typeof PARSER_ERROR_CODES)[number];

/** Error codes that are never worth another attempt. */
export const NON_RETRYABLE_ERROR_CODES: readonly ParserErrorCode[] = [
  "UNSUPPORTED_FILE_TYPE",
  "INVALID_FILE",
  "EMPTY_FILE",
  "FILE_TOO_LARGE",
  "PDF_ENCRYPTED",
  "PDF_CORRUPTED",
  "MALWARE_QUARANTINED",
  "PARSER_NOT_CONFIGURED",
  "PARSER_RESULT_INVALID",
  "QUALITY_REVIEW_REQUIRED",
] as const;

/**
 * A parser failure with a code that is safe to persist and expose.
 *
 * `message` must never carry provider response bodies, credentials, signed
 * URLs, or document content — providers are responsible for sanitising before
 * constructing this. `retryable` is decided by the provider (which knows what a
 * given HTTP status means) rather than inferred from the code alone, but
 * defaults from the code so a provider cannot accidentally mark
 * PDF_ENCRYPTED retryable.
 */
export class DocumentParserError extends Error {
  readonly code: ParserErrorCode;
  readonly retryable: boolean;
  /** Provider status string, when the failure came from one. Sanitised. */
  readonly providerStatus?: string;

  constructor(
    code: ParserErrorCode,
    message: string,
    options?: { retryable?: boolean; providerStatus?: string; cause?: unknown }
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DocumentParserError";
    this.code = code;
    const defaultRetryable = !NON_RETRYABLE_ERROR_CODES.includes(code);
    this.retryable = options?.retryable ?? defaultRetryable;
    this.providerStatus = options?.providerStatus;
  }
}

export function isDocumentParserError(value: unknown): value is DocumentParserError {
  return value instanceof DocumentParserError;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/**
 * How the document reaches the provider.
 *
 * `inline` sends the bytes in the request body. `signed-url` hands the provider
 * a short-lived URL to Qubere-controlled object storage. Client-supplied URLs
 * are never an option here — that would be an SSRF vector.
 */
export type SourceDelivery = "inline" | "signed-url";

export interface ParserSourceInline {
  kind: "inline";
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export interface ParserSourceSignedUrl {
  kind: "signed-url";
  filename: string;
  mimeType: string;
  /** Must resolve to an allowlisted Qubere storage host. */
  url: string;
  expiresAt: Date;
}

export type ParserSource = ParserSourceInline | ParserSourceSignedUrl;

export interface ParserSubmission {
  /** Opaque Qubere run id. Providers may pass it through for correlation. */
  runId: string;
  /** Correlation id propagated across upload -> queue -> provider -> result. */
  correlationId: string;
  profile: ProcessingProfile;
  source: ParserSource;
}

export interface ParserSubmissionAck {
  /** Durable provider-side task identifier. Persisted immediately. */
  externalTaskId: string;
  /** Raw provider status at submission, already sanitised. */
  providerStatus: string;
  /** Qubere state to record. Providers that complete synchronously may return SUCCEEDED. */
  state: Extract<ProcessingRunState, "SUBMITTED" | "POLLING" | "SUCCEEDED">;
  /**
   * Profile options this provider could not honour. Recorded as warnings on the
   * run so nobody reads "FULL_PAGE_OCR" as proof full-page OCR actually ran.
   */
  unsupportedOptions: readonly string[];
  submittedAt: Date;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface ParserJobReference {
  runId: string;
  externalTaskId: string;
  correlationId: string;
}

export interface ParserJobStatus {
  /** Never SUCCEEDED-with-no-result: SUCCEEDED here means getResult may be called. */
  state: Extract<ProcessingRunState, "POLLING" | "SUCCEEDED" | "FAILED">;
  /** Sanitised provider status string, kept for operational forensics. */
  providerStatus: string;
  /** Present only when state is FAILED. */
  error?: DocumentParserError;
  observedAt: Date;
}

// ---------------------------------------------------------------------------
// Result — normalised, provider-neutral
// ---------------------------------------------------------------------------

/**
 * A bounding box in the coordinate space the parser reported, with its origin
 * recorded rather than assumed. Never synthesised: absent provenance is absent.
 */
export const boundingBoxSchema = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  /** Coordinate origin as reported by the parser, when it says. */
  coordOrigin: z.enum(["TOPLEFT", "BOTTOMLEFT"]).nullable(),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const provenanceSchema = z.object({
  page: z.number().int().positive().nullable(),
  bbox: boundingBoxSchema.nullable(),
  /** Provider's own element reference (e.g. a JSON pointer), when it has one. */
  elementRef: z.string().nullable(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const parsedSectionSchema = z.object({
  /** Deterministic id derived from position + content hash. Stable across reruns. */
  id: z.string().min(1),
  /** Heading trail from the document root, outermost first. */
  headingPath: z.array(z.string()),
  /** Section text, or compact Markdown when the section carries structure. */
  content: z.string(),
  provenance: z.array(provenanceSchema),
});
export type ParsedSection = z.infer<typeof parsedSectionSchema>;

export const parsedTableCellSchema = z.object({
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  rowSpan: z.number().int().positive(),
  columnSpan: z.number().int().positive(),
  isHeader: z.boolean(),
  text: z.string(),
  provenance: provenanceSchema.nullable(),
});
export type ParsedTableCell = z.infer<typeof parsedTableCellSchema>;

export const parsedTableSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  caption: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  bbox: boundingBoxSchema.nullable(),
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  cells: z.array(parsedTableCellSchema),
  /** Loss-minimising derivative the provider supplied. Null when it did not. */
  html: z.string().nullable(),
});
export type ParsedTable = z.infer<typeof parsedTableSchema>;

export const parserWarningSchema = z.object({
  /** Stable, low-cardinality code — safe as a metric label. */
  code: z.string().min(1),
  message: z.string(),
  page: z.number().int().positive().nullable(),
});
export type ParserWarning = z.infer<typeof parserWarningSchema>;

/**
 * Facts about the parse. Every field is nullable because "the provider did not
 * report this" is a real and common answer, and inventing a value here would
 * fabricate parser confidence or OCR usage.
 */
export const parserMetadataSchema = z.object({
  provider: z.string().min(1),
  /** Parser name as the provider reports it (e.g. "docling"). Null if unreported. */
  parserName: z.string().nullable(),
  /** Parser runtime version as reported. Null if the hosted API does not expose it. */
  parserVersion: z.string().nullable(),
  ocrEngine: z.string().nullable(),
  ocrEngineVersion: z.string().nullable(),
  pageCount: z.number().int().nonnegative().nullable(),
  /** True/false only when the provider actually says. Null means unknown. */
  ocrUsed: z.boolean().nullable(),
  fullPageOcrUsed: z.boolean().nullable(),
  processingDurationMs: z.number().int().nonnegative().nullable(),
  /** Parser-emitted confidence, ONLY when genuinely emitted. Never synthesised. */
  parserConfidence: z.number().nullable(),
  ocrConfidence: z.number().nullable(),
});
export type ParserMetadata = z.infer<typeof parserMetadataSchema>;

export const parserResultSchema = z.object({
  contractVersion: z.literal(QUBERE_PARSER_CONTRACT_VERSION),
  profile: z.enum(PROCESSING_PROFILES),
  metadata: parserMetadataSchema,
  /** Derivative full-document Markdown, when the provider produced it. */
  markdown: z.string().nullable(),
  sections: z.array(parsedSectionSchema),
  tables: z.array(parsedTableSchema),
  warnings: z.array(parserWarningSchema),
  /** Per-page text length, used by the quality gate. Empty when unavailable. */
  pageTextLengths: z.array(z.number().int().nonnegative()),
});
export type NormalizedParserResult = z.infer<typeof parserResultSchema>;

/**
 * What `getResult` returns: the canonical provider payload plus Qubere's
 * normalisation of it. The canonical payload is authoritative and is persisted
 * verbatim; the normalisation is derivative and re-derivable.
 */
export interface ParserResult {
  /** The provider's complete structured document, untouched. */
  canonical: unknown;
  normalized: NormalizedParserResult;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface DocumentParserProvider {
  /** Stable identifier persisted on the run, e.g. "IBM_DOCLING" or "MOCK". */
  readonly providerId: string;
  /** True for providers that must never be trusted in production. */
  isMockProvider(): boolean;
  /** How this provider wants the document delivered. */
  readonly sourceDelivery: SourceDelivery;
  /**
   * Hash of the provider configuration that affects output (base URL, profile
   * option mapping, contract version). Feeds the run idempotency key so a
   * configuration change produces a new run rather than colliding with an old one.
   */
  configurationHash(profile: ProcessingProfile): string;

  submit(submission: ParserSubmission): Promise<ParserSubmissionAck>;
  getStatus(ref: ParserJobReference): Promise<ParserJobStatus>;
  getResult(ref: ParserJobReference, profile: ProcessingProfile): Promise<ParserResult>;
}
