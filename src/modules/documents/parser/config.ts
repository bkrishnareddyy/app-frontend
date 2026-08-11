/**
 * Document parser configuration.
 *
 * Every environment-specific value used by the parsing subsystem is read here
 * and nowhere else, so no URL, header name, or timeout is hard-coded next to the
 * code that uses it. Reading is lazy and re-evaluated per call rather than
 * frozen at module load, because Next.js route modules and the standalone worker
 * load in different processes and tests need to vary the environment.
 */

import { z } from "zod";
import { DocumentParserError, PROCESSING_PROFILES, type ProcessingProfile } from "./contracts";

export const PARSER_PROVIDER_IDS = ["ibm-docling", "mock", "none"] as const;
export type ParserProviderId = (typeof PARSER_PROVIDER_IDS)[number];

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Which provider the process should use. Defaults to none so nothing pretends. */
export function selectedProviderId(): ParserProviderId {
  const raw = (process.env.DOCUMENT_PARSER_PROVIDER ?? "").trim().toLowerCase();
  if ((PARSER_PROVIDER_IDS as readonly string[]).includes(raw)) {
    return raw as ParserProviderId;
  }
  return "none";
}

export interface IbmDoclingConfig {
  baseUrl: string;
  apiKey: string;
  /** Header the key is sent in. IBM deployments differ, so this is configurable. */
  authHeaderName: string;
  /** Scheme prefix, e.g. "Bearer". Empty string sends the key bare. */
  authHeaderScheme: string;
  requestTimeoutMs: number;
  /** Route templates, configurable because hosted deployments differ in prefix. */
  submitPath: string;
  statusPathTemplate: string;
  resultPathTemplate: string;
  /** `inline` posts the bytes; `signed-url` hands over a Qubere storage URL. */
  sourceDelivery: "inline" | "signed-url";
  /**
   * How the submission body is encoded.
   *
   * docling-serve exposes two submission endpoints that are NOT interchangeable:
   * `/convert/source/...` takes a JSON body carrying the document as base64 or a
   * URL, while `/convert/file/...` takes a `multipart/form-data` upload. Sending
   * the wrong encoding is rejected by the server, so this follows the configured
   * submit path by default (see `submitEncodingFor`) and can be overridden with
   * DOCLING_SUBMIT_ENCODING when a deployment does not follow that naming.
   */
  submitEncoding: "json" | "multipart";
}

/**
 * Picks the submission encoding implied by the endpoint path.
 *
 * `/convert/file` is the multipart upload endpoint; `/convert/source` is the
 * JSON one. Deriving it means a correct base URL and path are enough to work,
 * with no third setting to get right.
 */
export function submitEncodingFor(submitPath: string): "json" | "multipart" {
  return /\/convert\/file(\/|$)/.test(submitPath) ? "multipart" : "json";
}

const ibmConfigSchema = z.object({
  baseUrl: z.string().url("DOCLING_API_BASE_URL must be an absolute URL"),
  apiKey: z.string().min(1, "DOCLING_API_KEY must be set"),
  authHeaderName: z.string().min(1),
  authHeaderScheme: z.string(),
  requestTimeoutMs: z.number().int().positive(),
  submitPath: z.string().startsWith("/"),
  statusPathTemplate: z.string().startsWith("/").includes("{taskId}"),
  resultPathTemplate: z.string().startsWith("/").includes("{taskId}"),
  sourceDelivery: z.enum(["inline", "signed-url"]),
  submitEncoding: z.enum(["json", "multipart"]),
});

/**
 * Reads and validates the IBM-hosted Docling configuration.
 *
 * Throws PARSER_NOT_CONFIGURED (non-retryable) rather than returning a partial
 * config, so a missing credential surfaces as an explicit blocked run instead of
 * a request that quietly fails against a default URL.
 */
export function readIbmDoclingConfig(): IbmDoclingConfig {
  // A full endpoint URL is accepted for DOCLING_API_BASE_URL, because that is
  // what an IBM console hands you. The submit path is split off it so the status
  // and result routes resolve against the same instance prefix, which on IBM
  // includes a per-deployment id segment before /v1.
  const rawBase = (process.env.DOCLING_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const embeddedSubmitPath = rawBase.match(/\/v\d+\/convert\/(?:file|source)(?:\/async)?$/i)?.[0];
  const baseUrl = embeddedSubmitPath ? rawBase.slice(0, -embeddedSubmitPath.length) : rawBase;

  const submitPath = (
    process.env.DOCLING_SUBMIT_PATH ??
    embeddedSubmitPath ??
    "/v1/convert/source/async"
  ).trim();

  const candidate = {
    baseUrl,
    apiKey: (process.env.DOCLING_API_KEY ?? "").trim(),
    authHeaderName: (process.env.DOCLING_AUTH_HEADER_NAME ?? "Authorization").trim(),
    authHeaderScheme: (process.env.DOCLING_AUTH_HEADER_SCHEME ?? "Bearer").trim(),
    requestTimeoutMs: intFromEnv("DOCUMENT_PARSER_REQUEST_TIMEOUT_MS", 60_000, 1_000, 600_000),
    submitPath,
    statusPathTemplate: (process.env.DOCLING_STATUS_PATH ?? "/v1/status/poll/{taskId}").trim(),
    resultPathTemplate: (process.env.DOCLING_RESULT_PATH ?? "/v1/result/{taskId}").trim(),
    sourceDelivery: (process.env.DOCLING_SOURCE_DELIVERY ?? "inline").trim(),
    submitEncoding: (process.env.DOCLING_SUBMIT_ENCODING ?? submitEncodingFor(submitPath)).trim(),
  };

  const parsed = ibmConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    // Report which settings are wrong, never their values.
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new DocumentParserError(
      "PARSER_NOT_CONFIGURED",
      `IBM hosted Docling is not configured correctly. Invalid or missing settings: ${fields}.`
    );
  }
  return parsed.data;
}

/** True when the IBM provider has everything it needs. Never logs the values. */
export function isIbmDoclingConfigured(): boolean {
  try {
    readIbmDoclingConfig();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Profile -> provider option mapping
// ---------------------------------------------------------------------------

/**
 * The only Docling conversion options Qubere sets, per profile.
 *
 * Deliberately minimal: these are the options confirmed to exist in the
 * documented `/convert/source/async` request contract. Anything else the
 * upstream Docling library supports is NOT set here, because a hosted
 * deployment may not expose it and a silently ignored option would make the
 * profile a lie. `declaredOptions` is what we sent; whether the provider
 * honoured it is only knowable from what it reports back.
 */
export interface ProfileOptions {
  /** Run OCR. */
  do_ocr: boolean;
  /**
   * Re-OCR pages that already contain a text layer. Only meaningful with
   * do_ocr; this is what distinguishes FULL_PAGE_OCR from OCR_FALLBACK.
   */
  force_ocr: boolean;
  /** Reconstruct table structure rather than flattening tables to text. */
  do_table_structure: boolean;
}

const PROFILE_OPTIONS: Readonly<Record<ProcessingProfile, ProfileOptions>> = {
  // Born-digital and common mixed documents: use the embedded text layer, and
  // let the provider's own OCR heuristics handle image-only pages. Table
  // structure is always on — flattened tables are unusable as customs evidence.
  STANDARD: { do_ocr: true, force_ocr: false, do_table_structure: true },
  // Same as STANDARD at the provider level; the difference is that Qubere only
  // reaches this profile after the quality gate objectively found insufficient
  // text, and records the retry reason on the new run.
  OCR_FALLBACK: { do_ocr: true, force_ocr: false, do_table_structure: true },
  // Explicitly scanned/image documents, explicit reprocess, or a quality retry
  // that OCR_FALLBACK did not fix. Never applied by default.
  FULL_PAGE_OCR: { do_ocr: true, force_ocr: true, do_table_structure: true },
};

export function profileOptions(profile: ProcessingProfile): ProfileOptions {
  return PROFILE_OPTIONS[profile];
}

// ---------------------------------------------------------------------------
// Worker / retry / polling limits
// ---------------------------------------------------------------------------

export interface ProcessingLimits {
  maxAttempts: number;
  pollInitialDelayMs: number;
  pollMaxDelayMs: number;
  maxPollAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  /** A PROCESSING run with no heartbeat for this long is reclaimable. */
  staleAfterMs: number;
  /** Upper bound on documents handled per worker tick. */
  batchSize: number;
  signedUrlTtlSeconds: number;
}

export function readProcessingLimits(): ProcessingLimits {
  return {
    maxAttempts: intFromEnv("DOCUMENT_PARSER_MAX_ATTEMPTS", 4, 1, 20),
    pollInitialDelayMs: intFromEnv("DOCUMENT_POLL_INITIAL_DELAY_MS", 5_000, 500, 300_000),
    pollMaxDelayMs: intFromEnv("DOCUMENT_POLL_MAX_DELAY_MS", 60_000, 1_000, 900_000),
    maxPollAttempts: intFromEnv("DOCUMENT_POLL_MAX_ATTEMPTS", 120, 1, 5_000),
    retryBaseDelayMs: intFromEnv("DOCUMENT_RETRY_BASE_DELAY_MS", 10_000, 1_000, 600_000),
    retryMaxDelayMs: intFromEnv("DOCUMENT_RETRY_MAX_DELAY_MS", 300_000, 1_000, 3_600_000),
    staleAfterMs: intFromEnv("DOCUMENT_PROCESSING_STALE_AFTER_MS", 600_000, 30_000, 7_200_000),
    batchSize: intFromEnv("DOCUMENT_WORKER_BATCH_SIZE", 5, 1, 50),
    signedUrlTtlSeconds: intFromEnv("SIGNED_URL_TTL_SECONDS", 300, 30, 3_600),
  };
}

export interface ContextBudget {
  maxTokens: number;
  maxBytes: number;
  maxChunks: number;
  maxTables: number;
}

export function readContextBudget(): ContextBudget {
  return {
    maxTokens: intFromEnv("DOCUMENT_CONTEXT_MAX_TOKENS", 24_000, 500, 500_000),
    maxBytes: intFromEnv("DOCUMENT_CONTEXT_MAX_BYTES", 400_000, 2_000, 8_000_000),
    maxChunks: intFromEnv("DOCUMENT_CONTEXT_MAX_CHUNKS", 120, 1, 5_000),
    maxTables: intFromEnv("DOCUMENT_CONTEXT_MAX_TABLES", 30, 1, 500),
  };
}

/**
 * Exponential backoff with full jitter, bounded.
 *
 * Jitter is applied because a burst of documents failing against the same
 * provider outage would otherwise retry in lockstep forever.
 */
export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);
  return Math.floor(exponential / 2 + Math.random() * (exponential / 2));
}

export function pollDelayMs(pollAttempt: number, limits: ProcessingLimits): number {
  return backoffDelayMs(pollAttempt, limits.pollInitialDelayMs, limits.pollMaxDelayMs);
}

/** Reports configuration state for the health endpoint. Contains no secrets. */
export function parserConfigurationReport(): {
  provider: ParserProviderId;
  configured: boolean;
  mock: boolean;
  profiles: readonly string[];
  contractVersion: string;
  blocker: string | null;
} {
  const provider = selectedProviderId();
  if (provider === "ibm-docling") {
    // Report the setting that actually failed. This used to name the base URL
    // and key regardless of the real cause, which sent you looking at the two
    // settings that were already correct when the broken one was elsewhere.
    let blocker: string | null = null;
    try {
      readIbmDoclingConfig();
    } catch (error) {
      blocker =
        error instanceof DocumentParserError
          ? `${error.message} No document can be parsed until this is corrected.`
          : "IBM hosted Docling could not be configured, so no document can be parsed.";
    }
    return {
      provider,
      configured: blocker === null,
      mock: false,
      profiles: PROCESSING_PROFILES,
      contractVersion: "qubere.parser/1",
      blocker,
    };
  }
  if (provider === "mock") {
    return {
      provider,
      configured: true,
      mock: true,
      profiles: PROCESSING_PROFILES,
      contractVersion: "qubere.parser/1",
      blocker: "Mock parser provider is selected. Results are NOT produced by IBM Docling.",
    };
  }
  return {
    provider: "none",
    configured: false,
    mock: false,
    profiles: PROCESSING_PROFILES,
    contractVersion: "qubere.parser/1",
    blocker: "DOCUMENT_PARSER_PROVIDER is not set, so document parsing is disabled.",
  };
}
