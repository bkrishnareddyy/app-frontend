/**
 * Local-development parser provider.
 *
 * This exists so the queue, worker, artifact store, quality gate and context
 * builder can be exercised without IBM credentials. It is not a Docling
 * emulator and does not read the document: it derives a small structured result
 * from the bytes it was handed, and labels every artifact it produces as
 * mock-produced so nothing downstream can be mistaken for a real parse.
 *
 * Three separate guards keep it out of production:
 *   - `isMockProvider()` returns true, and the registry refuses it in production;
 *   - the constructor throws when NODE_ENV is production;
 *   - `metadata.provider` is "MOCK_PARSER", which is persisted on every run and
 *     every artifact, so an existing run's origin is auditable after the fact.
 */

import { createHash } from "crypto";
import {
  DocumentParserError,
  QUBERE_PARSER_CONTRACT_VERSION,
  type DocumentParserProvider,
  type ParserJobReference,
  type ParserJobStatus,
  type ParserResult,
  type ParserSubmission,
  type ParserSubmissionAck,
  type ProcessingProfile,
  type SourceDelivery,
} from "../contracts";

interface MockTask {
  profile: ProcessingProfile;
  filename: string;
  byteSize: number;
  /** Text recovered from the bytes, when they were text at all. */
  recoveredText: string;
  pollsRemaining: number;
}

const MOCK_PROVIDER_ID = "MOCK_PARSER";

/**
 * Task state lives in memory, which is exactly why this provider is unusable in
 * production: a restart loses every in-flight task. Qubere's own run state is
 * durable in Postgres regardless, so a lost mock task surfaces as a run that
 * fails its poll ceiling rather than as silent data loss.
 */
const tasks = new Map<string, MockTask>();

/**
 * True when the bytes round-trip through UTF-8 unchanged and carry no PDF
 * header. A PDF is deliberately not decoded — the mock has no parser — so it
 * yields an empty-text result, which is the honest outcome and usefully drives
 * the quality gate down an OCR path.
 */
function decodeTextOrEmpty(bytes: Buffer): string {
  if (bytes.subarray(0, 4).toString("latin1") === "%PDF") return "";
  const decoded = bytes.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(bytes) ? decoded : "";
}

export class MockDoclingProvider implements DocumentParserProvider {
  readonly providerId = MOCK_PROVIDER_ID;

  /** Number of polls before the task reports success, so polling is exercised. */
  private readonly pollsBeforeSuccess: number;

  constructor(options?: { pollsBeforeSuccess?: number }) {
    if (process.env.NODE_ENV === "production") {
      throw new DocumentParserError(
        "PARSER_NOT_CONFIGURED",
        "The mock document parser cannot run in production. Set DOCUMENT_PARSER_PROVIDER=ibm-docling."
      );
    }
    this.pollsBeforeSuccess = options?.pollsBeforeSuccess ?? 1;
  }

  isMockProvider(): boolean {
    return true;
  }

  get sourceDelivery(): SourceDelivery {
    return "inline";
  }

  configurationHash(profile: ProcessingProfile): string {
    return createHash("sha256").update(`mock:${profile}`).digest("hex").slice(0, 32);
  }

  async submit(submission: ParserSubmission): Promise<ParserSubmissionAck> {
    if (submission.source.kind !== "inline") {
      throw new DocumentParserError(
        "PARSER_SUBMISSION_FAILED",
        "The mock parser only accepts inline sources.",
        { retryable: false }
      );
    }

    const bytes = submission.source.bytes;
    if (bytes.length === 0) {
      throw new DocumentParserError("EMPTY_FILE", "The submitted document is empty.");
    }

    const externalTaskId = `mock_${createHash("sha256")
      .update(`${submission.runId}:${bytes.length}`)
      .digest("hex")
      .slice(0, 16)}`;

    tasks.set(externalTaskId, {
      profile: submission.profile,
      filename: submission.source.filename,
      byteSize: bytes.length,
      recoveredText: decodeTextOrEmpty(bytes),
      pollsRemaining: this.pollsBeforeSuccess,
    });

    return {
      externalTaskId,
      providerStatus: "pending",
      state: "SUBMITTED",
      unsupportedOptions: ["ocrUsed", "fullPageOcrUsed", "parserConfidence", "mockProviderIsNotDocling"],
      submittedAt: new Date(),
    };
  }

  async getStatus(ref: ParserJobReference): Promise<ParserJobStatus> {
    const task = tasks.get(ref.externalTaskId);
    if (!task) {
      return {
        state: "FAILED",
        providerStatus: "unknown_task",
        error: new DocumentParserError(
          "PARSER_PROVIDER_ERROR",
          "The mock parser has no record of this task; its state does not survive a restart.",
          { retryable: false, providerStatus: "unknown_task" }
        ),
        observedAt: new Date(),
      };
    }

    if (task.pollsRemaining > 0) {
      task.pollsRemaining -= 1;
      return { state: "POLLING", providerStatus: "started", observedAt: new Date() };
    }
    return { state: "SUCCEEDED", providerStatus: "success", observedAt: new Date() };
  }

  async getResult(ref: ParserJobReference, profile: ProcessingProfile): Promise<ParserResult> {
    const task = tasks.get(ref.externalTaskId);
    if (!task) {
      throw new DocumentParserError(
        "PARSER_PROVIDER_ERROR",
        "The mock parser has no record of this task.",
        { retryable: false }
      );
    }

    const lines = task.recoveredText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");

    const content = lines.join("\n");
    const digest = createHash("sha256").update(content).digest("hex").slice(0, 12);

    const canonical = {
      schema_name: "MockParserDocument",
      version: "0.0.0-mock",
      name: task.filename,
      note: "Produced by Qubere's mock parser provider. NOT a Docling result.",
      texts: lines.map((text, index) => ({ self_ref: `#/texts/${index}`, label: "text", text })),
      tables: [],
      pages: content === "" ? {} : { "1": { page_no: 1 } },
    };

    return {
      canonical,
      normalized: {
        contractVersion: QUBERE_PARSER_CONTRACT_VERSION,
        profile,
        metadata: {
          provider: MOCK_PROVIDER_ID,
          parserName: "MockParserDocument",
          parserVersion: "0.0.0-mock",
          ocrEngine: null,
          ocrEngineVersion: null,
          pageCount: content === "" ? 0 : 1,
          ocrUsed: null,
          fullPageOcrUsed: null,
          processingDurationMs: null,
          parserConfidence: null,
          ocrConfidence: null,
        },
        markdown: content === "" ? null : content,
        sections:
          content === ""
            ? []
            : [
                {
                  id: `sec_0000_${digest}`,
                  headingPath: [],
                  content,
                  // No coordinates exist, so none are reported. The element ref
                  // is real: it points into the canonical payload above.
                  provenance: [{ page: 1, bbox: null, elementRef: "#/texts/0" }],
                },
              ],
        tables: [],
        warnings: [
          {
            code: "MOCK_PROVIDER",
            message:
              "This result came from Qubere's mock parser provider, not from IBM Docling. It must not be treated as evidence.",
            page: null,
          },
        ],
        pageTextLengths: content === "" ? [] : [content.length],
      },
    };
  }
}

/** Test/dev helper: clears in-memory task state between runs. */
export function resetMockParserTasks(): void {
  tasks.clear();
}
