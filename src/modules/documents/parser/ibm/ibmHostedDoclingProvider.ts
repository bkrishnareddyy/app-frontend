/**
 * IBM-hosted Docling parser provider.
 *
 * This is the only module in the codebase that knows IBM's endpoints, headers,
 * request shape, or status vocabulary. Everything it returns is expressed in the
 * provider-neutral Qubere parser contract.
 *
 * It never builds a separate Docling service, and never falls back to a local
 * parser: if IBM is unreachable or unconfigured, the run fails with a structured
 * code and the failure is visible.
 */

import { createHash } from "crypto";
import {
  DocumentParserError,
  isDocumentParserError,
  type DocumentParserProvider,
  type ParserJobReference,
  type ParserJobStatus,
  type ParserResult,
  type ParserSubmission,
  type ParserSubmissionAck,
  type ProcessingProfile,
  type SourceDelivery,
} from "../contracts";
import { profileOptions, readIbmDoclingConfig, type IbmDoclingConfig } from "../config";
import { adaptDoclingResult, normalizeDoclingDocument, translateTaskStatus } from "./doclingAdapter";
import {
  DOCLING_JSON_ARTIFACT_TYPES,
  DOCLING_MARKDOWN_ARTIFACT_TYPES,
  DOCLING_WIRE_CONTRACT_VERSION,
  doclingBatchResultSchema,
  doclingDocumentSchema,
  doclingTaskEnvelopeSchema,
  type DoclingBatchResult,
  type DoclingConvertOptions,
  type DoclingDocument,
  type DoclingSourceEnvelope,
} from "./doclingWire";
import { assertQubereStorageUrl } from "@/lib/storage";

/** Statuses whose HTTP code means "try again later". */
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 507, 509]);

/**
 * Hosts an artifact URL may point at, beyond the parser's own host.
 *
 * The hosted service returns converted content as presigned object-storage URLs,
 * so the storage host has to be reachable. It is still an allowlist rather than
 * "follow whatever the response says", because a malformed or hostile result
 * payload must not be able to make this server fetch an internal address.
 *
 * Overridable with DOCLING_ARTIFACT_HOSTS (comma-separated) for a deployment
 * that stores artifacts elsewhere.
 */
const DEFAULT_ARTIFACT_HOSTS = [
  "s3.amazonaws.com",
  "s3.us-east-1.amazonaws.com",
  "s3.us-east-2.amazonaws.com",
  "s3.us-west-2.amazonaws.com",
  "s3.eu-west-1.amazonaws.com",
  "s3.eu-de.cloud-object-storage.appdomain.cloud",
  "s3.us-south.cloud-object-storage.appdomain.cloud",
];

function allowedArtifactHosts(parserBaseUrl: string): string[] {
  const configured = (process.env.DOCLING_ARTIFACT_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");

  const hosts = configured.length > 0 ? configured : [...DEFAULT_ARTIFACT_HOSTS];
  try {
    hosts.push(new URL(parserBaseUrl).hostname.toLowerCase());
  } catch {
    // A malformed base URL is already rejected by config validation.
  }
  return hosts;
}

/**
 * Throws unless an artifact URL is https and points at an allowlisted host.
 *
 * The URL itself never appears in the error: a presigned URL carries credentials
 * in its query string, so it must not reach a log or a response body.
 */
export function assertAllowedArtifactHost(uri: string, parserBaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new DocumentParserError(
      "PARSER_RESULT_INVALID",
      "The parser returned a malformed artifact link.",
      { retryable: false }
    );
  }

  if (parsed.protocol !== "https:") {
    throw new DocumentParserError(
      "PARSER_RESULT_INVALID",
      "The parser returned an artifact link that is not https.",
      { retryable: false }
    );
  }

  const host = parsed.hostname.toLowerCase();
  const allowed = allowedArtifactHosts(parserBaseUrl).some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`)
  );

  if (!allowed) {
    throw new DocumentParserError(
      "PARSER_RESULT_INVALID",
      `The parser returned an artifact link on an unexpected host ("${host}"). Add it to DOCLING_ARTIFACT_HOSTS if that host is genuinely yours.`,
      { retryable: false }
    );
  }
}

function sourceEnvelopeMode(): DoclingSourceEnvelope {
  return (process.env.DOCLING_SOURCE_ENVELOPE ?? "sources").trim().toLowerCase() === "typed"
    ? "typed"
    : "sources";
}

/**
 * Classifies an HTTP failure without ever putting the response body in the
 * message. A provider that echoes document content in an error must not turn
 * that content into a persisted, user-visible error string.
 */
function httpFailure(operation: string, status: number, statusText: string): DocumentParserError {
  const retryable = RETRYABLE_HTTP_STATUSES.has(status);
  const code =
    status === 401 || status === 403
      ? "PARSER_NOT_CONFIGURED"
      : status === 404
        ? "PARSER_PROVIDER_ERROR"
        : status === 408 || status === 504
          ? "PARSER_TIMEOUT"
          : "PARSER_PROVIDER_ERROR";

  return new DocumentParserError(
    code,
    `The document parser rejected the ${operation} request (HTTP ${status} ${statusText}).`,
    { retryable: code === "PARSER_NOT_CONFIGURED" ? false : retryable, providerStatus: String(status) }
  );
}

export class IbmHostedDoclingProvider implements DocumentParserProvider {
  readonly providerId = "IBM_DOCLING";

  private readonly config: IbmDoclingConfig;

  constructor(config?: IbmDoclingConfig) {
    // Read eagerly so a misconfiguration surfaces when the provider is resolved,
    // not halfway through a run.
    this.config = config ?? readIbmDoclingConfig();
  }

  isMockProvider(): boolean {
    return false;
  }

  get sourceDelivery(): SourceDelivery {
    return this.config.sourceDelivery;
  }

  /**
   * Hashes the settings that change what the provider produces. The API key is
   * excluded — rotating a credential does not change the parse, and hashing a
   * secret into a stored column is a needless exposure.
   */
  configurationHash(profile: ProcessingProfile): string {
    const options = profileOptions(profile);
    const material = JSON.stringify({
      wire: DOCLING_WIRE_CONTRACT_VERSION,
      baseUrl: this.config.baseUrl,
      submitPath: this.config.submitPath,
      envelope: sourceEnvelopeMode(),
      encoding: this.config.submitEncoding,
      delivery: this.config.sourceDelivery,
      profile,
      options,
    });
    return createHash("sha256").update(material).digest("hex").slice(0, 32);
  }

  // -------------------------------------------------------------------------
  // HTTP plumbing
  // -------------------------------------------------------------------------

  private authHeaders(): Record<string, string> {
    const value =
      this.config.authHeaderScheme === ""
        ? this.config.apiKey
        : `${this.config.authHeaderScheme} ${this.config.apiKey}`;
    return { [this.config.authHeaderName]: value };
  }

  private url(pathTemplate: string, taskId?: string): string {
    const path = taskId === undefined
      ? pathTemplate
      : pathTemplate.replace("{taskId}", encodeURIComponent(taskId));
    return `${this.config.baseUrl}${path}`;
  }

  /**
   * Performs a request with an enforced timeout and JSON parsing.
   *
   * `correlationId` is forwarded so a Qubere run can be traced into the
   * provider's own logs. No other Qubere identifier is sent.
   */
  private async request(
    operation: string,
    url: string,
    init: { method: "GET" | "POST"; body?: string | FormData; correlationId: string }
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    // FormData must set its own Content-Type so fetch can append the multipart
    // boundary; setting it by hand produces a body the server cannot parse.
    const isMultipart = typeof FormData !== "undefined" && init.body instanceof FormData;

    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          ...this.authHeaders(),
          Accept: "application/json",
          "X-Correlation-Id": init.correlationId,
          ...(init.body === undefined || isMultipart
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: init.body,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new DocumentParserError(
        aborted ? "PARSER_TIMEOUT" : "PARSER_PROVIDER_ERROR",
        aborted
          ? `The document parser did not respond to the ${operation} request within ${this.config.requestTimeoutMs}ms.`
          : `The document parser could not be reached for the ${operation} request.`,
        { retryable: true, cause: error }
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw httpFailure(operation, response.status, response.statusText);
    }

    try {
      return await response.json();
    } catch (error) {
      throw new DocumentParserError(
        "PARSER_RESULT_INVALID",
        `The document parser returned a non-JSON response to the ${operation} request.`,
        { retryable: false, cause: error }
      );
    }
  }

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  private convertOptions(profile: ProcessingProfile): DoclingConvertOptions {
    const options = profileOptions(profile);
    return {
      // JSON is the canonical artifact; Markdown is requested as a derivative so
      // we do not have to re-render it ourselves and risk drifting from Docling.
      to_formats: ["json", "md"],
      do_ocr: options.do_ocr,
      force_ocr: options.force_ocr,
      do_table_structure: options.do_table_structure,
      // Page images would multiply payload size for no downstream consumer.
      include_images: false,
    };
  }

  private buildSourcePayload(submission: ParserSubmission): Record<string, unknown> {
    const { source } = submission;

    if (source.kind === "signed-url") {
      // The URL must be one Qubere minted against its own storage. A
      // client-supplied URL reaching the provider would be an SSRF primitive
      // with the provider as the confused deputy.
      assertQubereStorageUrl(source.url);
      if (sourceEnvelopeMode() === "typed") {
        return { http_sources: [{ url: source.url }] };
      }
      return { sources: [{ kind: "http", url: source.url }] };
    }

    const base64 = source.bytes.toString("base64");
    if (sourceEnvelopeMode() === "typed") {
      return { file_sources: [{ base64_string: base64, filename: source.filename }] };
    }
    return { sources: [{ kind: "file", base64_string: base64, filename: source.filename }] };
  }

  /**
   * Builds the `multipart/form-data` body the `/convert/file/...` endpoints take.
   *
   * The conversion options travel as ordinary form fields rather than a nested
   * JSON object, and a list-valued option is repeated once per value, which is
   * how the server parses `to_formats`. Booleans are sent as "true"/"false"
   * strings because a form field has no other representation for them.
   */
  private buildMultipartBody(submission: ParserSubmission): FormData {
    const { source } = submission;
    if (source.kind !== "inline") {
      throw new DocumentParserError(
        "PARSER_SUBMISSION_FAILED",
        "The multipart submission endpoint uploads the document itself and cannot take a URL. Set DOCLING_SOURCE_DELIVERY=inline, or point DOCLING_SUBMIT_PATH at a /convert/source endpoint.",
        { retryable: false }
      );
    }

    const form = new FormData();
    const options = this.convertOptions(submission.profile);

    for (const format of options.to_formats) form.append("to_formats", format);
    form.append("do_ocr", String(options.do_ocr));
    form.append("force_ocr", String(options.force_ocr));
    form.append("do_table_structure", String(options.do_table_structure));
    form.append("include_images", String(options.include_images));

    // A fresh Uint8Array copy: Blob does not accept a Node Buffer's underlying
    // ArrayBuffer view directly across every runtime, and the original bytes are
    // the immutable source evidence and must not be handed out by reference.
    const bytes = new Uint8Array(source.bytes);
    form.append("files", new Blob([bytes], { type: source.mimeType }), source.filename);

    return form;
  }

  /**
   * Reports the profile options this provider cannot vouch for.
   *
   * The hosted API accepts `do_ocr`/`force_ocr` but does not report back whether
   * OCR actually ran, so a FULL_PAGE_OCR run can only ever claim "full-page OCR
   * was requested". Recording that here keeps the run honest instead of letting
   * the profile name imply a verified behaviour.
   */
  private unsupportedOptions(profile: ProcessingProfile): readonly string[] {
    const unverifiable = ["ocrUsed", "fullPageOcrUsed", "ocrEngine", "parserConfidence"];
    return profile === "STANDARD"
      ? unverifiable
      : [...unverifiable, "ocrRequestedButNotConfirmedByProvider"];
  }

  async submit(submission: ParserSubmission): Promise<ParserSubmissionAck> {
    // `/convert/file/...` takes a multipart upload; `/convert/source/...` takes a
    // JSON body. Sending the wrong one is rejected by the server, so the encoding
    // follows the configured endpoint.
    const body =
      this.config.submitEncoding === "multipart"
        ? this.buildMultipartBody(submission)
        : JSON.stringify({
            options: this.convertOptions(submission.profile),
            ...this.buildSourcePayload(submission),
          });

    const payload = await this.request("submission", this.url(this.config.submitPath), {
      method: "POST",
      body,
      correlationId: submission.correlationId,
    });

    const parsed = doclingTaskEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DocumentParserError(
        "PARSER_SUBMISSION_FAILED",
        "The document parser accepted the submission but returned no usable task identifier.",
        { retryable: false }
      );
    }

    const providerStatus = parsed.data.task_status ?? "unknown";
    const { state } = translateTaskStatus(providerStatus);

    return {
      externalTaskId: parsed.data.task_id,
      providerStatus,
      // A provider that reports success at submission time is unusual but legal;
      // FAILED at submission is a submission failure, not a completed run.
      state: state === "SUCCEEDED" ? "SUCCEEDED" : "SUBMITTED",
      unsupportedOptions: this.unsupportedOptions(submission.profile),
      submittedAt: new Date(),
    };
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  async getStatus(ref: ParserJobReference): Promise<ParserJobStatus> {
    const payload = await this.request(
      "status",
      this.url(this.config.statusPathTemplate, ref.externalTaskId),
      { method: "GET", correlationId: ref.correlationId }
    );

    const parsed = doclingTaskEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new DocumentParserError(
        "PARSER_RESULT_INVALID",
        "The document parser returned an unrecognised status payload.",
        { retryable: false }
      );
    }

    const providerStatus = parsed.data.task_status ?? "unknown";
    const { state, recognised } = translateTaskStatus(providerStatus);
    const observedAt = new Date();

    if (state === "FAILED") {
      return {
        state,
        providerStatus,
        error: new DocumentParserError(
          "PARSER_PROVIDER_ERROR",
          `The document parser reported the conversion as "${providerStatus}".`,
          // A provider-side failure of the conversion itself is not fixed by
          // resubmitting the same bytes with the same options.
          { retryable: false, providerStatus }
        ),
        observedAt,
      };
    }

    if (!recognised) {
      // Kept polling, but the unknown status is surfaced so an unfamiliar
      // provider vocabulary shows up in operations rather than silently
      // extending every run to its poll ceiling.
      console.warn("[IbmHostedDoclingProvider] unrecognised provider task status", {
        runId: ref.runId,
        providerStatus,
      });
    }

    return { state, providerStatus, observedAt };
  }

  // -------------------------------------------------------------------------
  // Result retrieval
  // -------------------------------------------------------------------------

  /**
   * Fetches one converted artifact from the presigned URL the service returned.
   *
   * The URL comes from the provider's response, so its host is checked against an
   * allowlist before any request is made: a result payload should never be able
   * to make this server fetch an arbitrary address. The URL is short-lived and is
   * never logged or persisted -- re-reading the task result mints a fresh one.
   */
  private async fetchArtifact(uri: string, correlationId: string): Promise<string> {
    assertAllowedArtifactHost(uri, this.config.baseUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      // Presigned URLs carry their own credentials in the query string; sending
      // the API key as well would leak it to the storage host.
      const response = await fetch(uri, {
        headers: { "X-Correlation-Id": correlationId },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new DocumentParserError(
          response.status === 403 ? "PARSER_TIMEOUT" : "PARSER_PROVIDER_ERROR",
          response.status === 403
            ? "The parser artifact link had expired before it could be read."
            : `The parser artifact could not be read (HTTP ${response.status}).`,
          // A 403 on a presigned URL means it expired; re-reading the result
          // issues a new one, so that is worth another attempt.
          { retryable: true }
        );
      }
      return await response.text();
    } catch (error) {
      if (isDocumentParserError(error)) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new DocumentParserError(
        aborted ? "PARSER_TIMEOUT" : "PARSER_PROVIDER_ERROR",
        aborted
          ? "Reading a parser artifact timed out."
          : "A parser artifact could not be retrieved.",
        { retryable: true, cause: error }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Normalises the batch-shaped result, in which converted content is delivered
   * as presigned artifact URLs rather than inline.
   */
  private async adaptBatchResult(
    batch: DoclingBatchResult,
    ref: ParserJobReference,
    profile: ProcessingProfile
  ): Promise<ParserResult> {
    // One document is submitted per run, so the first entry is this run's.
    const document = batch.documents[0];
    if (!document) {
      throw new DocumentParserError(
        "PARSER_RESULT_INCOMPLETE",
        "The parser returned a result containing no documents.",
        { retryable: false }
      );
    }

    const status = (document.status ?? "").toLowerCase();
    if (status !== "" && !["success", "succeeded", "partial_success", "completed"].includes(status)) {
      throw new DocumentParserError(
        "PARSER_PROVIDER_ERROR",
        `The parser reported this document as "${document.status}".`,
        { retryable: false, providerStatus: document.status }
      );
    }

    const artifacts = document.artifacts ?? [];
    const find = (types: readonly string[]) =>
      artifacts.find((a) => types.includes(a.artifact_type.toLowerCase()));

    const jsonArtifact = find(DOCLING_JSON_ARTIFACT_TYPES);
    const markdownArtifact = find(DOCLING_MARKDOWN_ARTIFACT_TYPES);

    if (!jsonArtifact && !markdownArtifact) {
      throw new DocumentParserError(
        "PARSER_RESULT_INCOMPLETE",
        `The parser produced no readable artifact. It offered: ${
          artifacts.map((a) => a.artifact_type).join(", ") || "none"
        }.`,
        { retryable: false }
      );
    }

    // Fetched in parallel: they are independent reads of short-lived URLs.
    const [jsonText, markdown] = await Promise.all([
      jsonArtifact ? this.fetchArtifact(jsonArtifact.uri, ref.correlationId) : Promise.resolve(null),
      markdownArtifact
        ? this.fetchArtifact(markdownArtifact.uri, ref.correlationId)
        : Promise.resolve(null),
    ]);

    let doc: DoclingDocument | null = null;
    if (jsonText !== null) {
      let raw: unknown;
      try {
        raw = JSON.parse(jsonText);
      } catch (error) {
        throw new DocumentParserError(
          "PARSER_RESULT_INVALID",
          "The parser's JSON artifact was not valid JSON.",
          { retryable: false, cause: error }
        );
      }
      const parsed = doclingDocumentSchema.safeParse(raw);
      if (!parsed.success) {
        throw new DocumentParserError(
          "PARSER_RESULT_INVALID",
          "The parser's JSON artifact did not match the expected document contract.",
          { retryable: false }
        );
      }
      doc = parsed.data;
    }

    return normalizeDoclingDocument({
      doc,
      markdown,
      profile,
      confidence: document.confidence,
      processingTimeSeconds: batch.processing_time ?? null,
      providerErrors: document.errors ?? [],
    });
  }

  async getResult(ref: ParserJobReference, profile: ProcessingProfile): Promise<ParserResult> {
    const payload = await this.request(
      "result",
      this.url(this.config.resultPathTemplate, ref.externalTaskId),
      { method: "GET", correlationId: ref.correlationId }
    );

    try {
      // This deployment answers with a batch envelope whose content sits behind
      // artifact URLs; the self-hosted /convert/source endpoints inline it
      // instead. Detect which arrived rather than assuming one.
      const batch = doclingBatchResultSchema.safeParse(payload);
      if (batch.success && Array.isArray(batch.data.documents)) {
        return await this.adaptBatchResult(batch.data, ref, profile);
      }
      return adaptDoclingResult(payload, profile);
    } catch (error) {
      if (isDocumentParserError(error)) throw error;
      throw new DocumentParserError(
        "PARSER_RESULT_INVALID",
        "The document parser result could not be normalised.",
        { retryable: false, cause: error }
      );
    }
  }
}
