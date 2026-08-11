import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DocumentParserError,
  NON_RETRYABLE_ERROR_CODES,
  PROCESSING_PROFILES,
  isLegalTransition,
  isProcessingProfile,
  TERMINAL_RUN_STATES,
  type ProcessingRunState,
} from "@/modules/documents/parser/contracts";
import {
  backoffDelayMs,
  isIbmDoclingConfigured,
  parserConfigurationReport,
  profileOptions,
  readIbmDoclingConfig,
  readProcessingLimits,
  selectedProviderId,
} from "@/modules/documents/parser/config";
import { buildIdempotencyKey } from "@/modules/documents/processing/processingRuns";

/**
 * The parser contract is the seam every provider is held to. These tests pin the
 * parts that must not drift: which state transitions exist, which failures are
 * worth retrying, what a profile actually asks the provider for, and how a run's
 * identity is derived.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("processing state machine", () => {
  it("advances a run through submit, poll and success", () => {
    expect(isLegalTransition("QUEUED", "SUBMITTED")).toBe(true);
    expect(isLegalTransition("SUBMITTED", "POLLING")).toBe(true);
    expect(isLegalTransition("POLLING", "POLLING")).toBe(true);
    expect(isLegalTransition("POLLING", "SUCCEEDED")).toBe(true);
    expect(isLegalTransition("POLLING", "NEEDS_REVIEW")).toBe(true);
  });

  it("never mutates an accepted run back into pending work", () => {
    // The whole point of immutable runs: a historical success must not be
    // re-queued, because reprocessing has to create a NEW run so the old
    // artifacts survive.
    for (const target of ["QUEUED", "SUBMITTED", "POLLING", "FAILED"] as ProcessingRunState[]) {
      expect(isLegalTransition("SUCCEEDED", target)).toBe(false);
      expect(isLegalTransition("NEEDS_REVIEW", target)).toBe(false);
    }
  });

  it("treats SUCCEEDED and NEEDS_REVIEW as terminal", () => {
    expect(TERMINAL_RUN_STATES).toContain("SUCCEEDED");
    expect(TERMINAL_RUN_STATES).toContain("NEEDS_REVIEW");
    expect(TERMINAL_RUN_STATES).not.toContain("FAILED");
  });

  it("allows only a re-queue out of FAILED", () => {
    expect(isLegalTransition("FAILED", "QUEUED")).toBe(true);
    expect(isLegalTransition("FAILED", "SUBMITTED")).toBe(false);
    expect(isLegalTransition("FAILED", "SUCCEEDED")).toBe(false);
  });

  it("cannot skip submission", () => {
    expect(isLegalTransition("QUEUED", "POLLING")).toBe(false);
    expect(isLegalTransition("QUEUED", "SUCCEEDED")).toBe(false);
  });
});

describe("structured parser errors", () => {
  it("defaults retryability from the code rather than the caller's optimism", () => {
    expect(new DocumentParserError("PARSER_TIMEOUT", "x").retryable).toBe(true);
    expect(new DocumentParserError("PARSER_PROVIDER_ERROR", "x").retryable).toBe(true);
    for (const code of NON_RETRYABLE_ERROR_CODES) {
      expect(new DocumentParserError(code, "x").retryable, code).toBe(false);
    }
  });

  it("classifies an unreadable file as never worth another attempt", () => {
    // Retrying an encrypted PDF forever burns the attempt budget and never
    // succeeds; it needs a person, not a retry.
    expect(new DocumentParserError("PDF_ENCRYPTED", "x").retryable).toBe(false);
    expect(new DocumentParserError("EMPTY_FILE", "x").retryable).toBe(false);
    expect(new DocumentParserError("UNSUPPORTED_FILE_TYPE", "x").retryable).toBe(false);
  });

  it("lets a provider override retryability when it knows better", () => {
    const error = new DocumentParserError("PARSER_PROVIDER_ERROR", "x", { retryable: false });
    expect(error.retryable).toBe(false);
  });
});

describe("processing profiles", () => {
  it("recognises exactly the three named profiles", () => {
    expect([...PROCESSING_PROFILES]).toEqual(["STANDARD", "OCR_FALLBACK", "FULL_PAGE_OCR"]);
    expect(isProcessingProfile("STANDARD")).toBe(true);
    expect(isProcessingProfile("MAGIC_OCR")).toBe(false);
  });

  it("does not force full-page OCR on a born-digital document under STANDARD", () => {
    // A born-digital PDF has a text layer. Re-OCRing it would be slower and
    // strictly worse than reading it, so force_ocr must stay off by default.
    expect(profileOptions("STANDARD").force_ocr).toBe(false);
    expect(profileOptions("OCR_FALLBACK").force_ocr).toBe(false);
  });

  it("only FULL_PAGE_OCR forces OCR over an existing text layer", () => {
    expect(profileOptions("FULL_PAGE_OCR").force_ocr).toBe(true);
    expect(profileOptions("FULL_PAGE_OCR").do_ocr).toBe(true);
  });

  it("always asks for table structure, so tables are never flattened to text", () => {
    for (const profile of PROCESSING_PROFILES) {
      expect(profileOptions(profile).do_table_structure, profile).toBe(true);
    }
  });
});

describe("run idempotency key", () => {
  const base = {
    accountId: "acct_1",
    contentSha256: "a".repeat(64),
    parserProvider: "IBM_DOCLING",
    profile: "STANDARD" as const,
    configHash: "cfg1",
  };

  it("is stable for identical work, so a duplicate delivery finds the same run", () => {
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base }));
  });

  it("separates tenants even for byte-identical documents", () => {
    // Two customers uploading the same invoice must not share a processing run.
    expect(buildIdempotencyKey({ ...base, accountId: "acct_2" })).not.toBe(
      buildIdempotencyKey(base)
    );
  });

  it("separates different content under the same filename", () => {
    expect(buildIdempotencyKey({ ...base, contentSha256: "b".repeat(64) })).not.toBe(
      buildIdempotencyKey(base)
    );
  });

  it("separates profiles, so an OCR retry is a new run and not a collision", () => {
    expect(buildIdempotencyKey({ ...base, profile: "FULL_PAGE_OCR" })).not.toBe(
      buildIdempotencyKey(base)
    );
  });

  it("separates provider configurations", () => {
    expect(buildIdempotencyKey({ ...base, configHash: "cfg2" })).not.toBe(
      buildIdempotencyKey(base)
    );
    expect(buildIdempotencyKey({ ...base, parserProvider: "MOCK_PARSER" })).not.toBe(
      buildIdempotencyKey(base)
    );
  });
});

describe("provider configuration", () => {
  beforeEach(() => {
    delete process.env.DOCUMENT_PARSER_PROVIDER;
    delete process.env.DOCLING_API_BASE_URL;
    delete process.env.DOCLING_API_KEY;
  });

  it("defaults to no provider rather than guessing one", () => {
    expect(selectedProviderId()).toBe("none");
    const report = parserConfigurationReport();
    expect(report.configured).toBe(false);
    expect(report.blocker).toMatch(/DOCUMENT_PARSER_PROVIDER/);
  });

  it("reports the mock provider as a blocker even though it is usable", () => {
    process.env.DOCUMENT_PARSER_PROVIDER = "mock";
    const report = parserConfigurationReport();
    expect(report.mock).toBe(true);
    // A mock parse must never read as a real one, even in a health check.
    expect(report.blocker).toMatch(/NOT produced by IBM Docling/);
  });

  it("refuses a partially configured IBM provider instead of using a default URL", () => {
    process.env.DOCUMENT_PARSER_PROVIDER = "ibm-docling";
    process.env.DOCLING_API_BASE_URL = "https://docling.example.invalid";
    expect(isIbmDoclingConfigured()).toBe(false);
    expect(() => readIbmDoclingConfig()).toThrowError(DocumentParserError);
    expect(parserConfigurationReport().blocker).toMatch(/apiKey/);
  });

  it("names the setting that actually failed, not a stock pair of settings", () => {
    // The blocker used to always blame the base URL and the key, which sends a
    // reader to inspect two settings that are already correct.
    process.env.DOCUMENT_PARSER_PROVIDER = "ibm-docling";
    process.env.DOCLING_API_BASE_URL = "https://docling.example.invalid";
    process.env.DOCLING_API_KEY = "k";
    process.env.DOCLING_SUBMIT_PATH = "v1/convert/file/async"; // missing leading slash

    const report = parserConfigurationReport();
    expect(report.configured).toBe(false);
    expect(report.blocker).toMatch(/submitPath/);
    expect(report.blocker).not.toMatch(/DOCLING_API_KEY/);
  });

  it("never puts a credential in the configuration error message", () => {
    process.env.DOCUMENT_PARSER_PROVIDER = "ibm-docling";
    process.env.DOCLING_API_BASE_URL = "not-a-url";
    process.env.DOCLING_API_KEY = "super-secret-key-value";
    const error = (() => {
      try {
        readIbmDoclingConfig();
        return null;
      } catch (err) {
        return err as Error;
      }
    })();
    expect(error).not.toBeNull();
    expect(error?.message).not.toContain("super-secret-key-value");
  });

  it("accepts a fully configured IBM provider and derives every route from config", () => {
    process.env.DOCUMENT_PARSER_PROVIDER = "ibm-docling";
    process.env.DOCLING_API_BASE_URL = "https://docling.example.invalid/";
    process.env.DOCLING_API_KEY = "k";
    const config = readIbmDoclingConfig();
    // Trailing slash trimmed so path joining cannot produce a double slash.
    expect(config.baseUrl).toBe("https://docling.example.invalid");
    expect(config.statusPathTemplate).toContain("{taskId}");
    expect(config.resultPathTemplate).toContain("{taskId}");
    expect(config.sourceDelivery).toBe("inline");
  });

  it("clamps out-of-range limits instead of trusting the environment", () => {
    process.env.DOCUMENT_PARSER_MAX_ATTEMPTS = "9999";
    process.env.DOCUMENT_POLL_MAX_DELAY_MS = "-5";
    const limits = readProcessingLimits();
    expect(limits.maxAttempts).toBeLessThanOrEqual(20);
    expect(limits.pollMaxDelayMs).toBeGreaterThan(0);
  });
});

describe("retry backoff", () => {
  it("grows with the attempt number and stays under the ceiling", () => {
    const ceiling = 60_000;
    const first = backoffDelayMs(1, 1_000, ceiling);
    const later = backoffDelayMs(8, 1_000, ceiling);
    expect(first).toBeGreaterThan(0);
    expect(later).toBeLessThanOrEqual(ceiling);
    expect(later).toBeGreaterThanOrEqual(first);
  });

  it("jitters, so a fleet of failed runs does not retry in lockstep", () => {
    const samples = new Set(
      Array.from({ length: 40 }, () => backoffDelayMs(5, 10_000, 300_000))
    );
    expect(samples.size).toBeGreaterThan(1);
  });
});
