/**
 * Qubere document processing worker.
 *
 * Owns orchestration end to end: claim due work, submit to the parser provider,
 * poll it, retrieve the result, persist artifacts, run the quality gate, promote
 * or retry, and hand off to classification/extraction. No parsing happens inside
 * a user-facing request, and no HTTP request is ever held open waiting for the
 * provider.
 *
 * `runWorkerTick` is a single bounded pass, deliberately: it is called both by the
 * cron endpoint (serverless deployments) and by the long-running worker loop
 * (`src/worker/documentWorker.ts`). Both share the same durable Postgres state,
 * so running both at once is safe — every transition is a conditional update, so
 * a run can only be advanced once.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import {
  DocumentParserError,
  isDocumentParserError,
  isProcessingProfile,
  type DocumentParserProvider,
  type ParserJobReference,
  type ProcessingProfile,
  type ProcessingReason,
  type ProcessingRunState,
} from "../parser/contracts";
import { pollDelayMs, readProcessingLimits } from "../parser/config";
import { getDocumentParserProvider } from "../parser/registry";
import { assessQuality, qualifiesAsActive } from "../parser/qualityGate";
import { persistRunArtifacts } from "../parser/artifactStore";
import {
  completeRun,
  createOrFindRun,
  failRun,
  findRunsAwaitingPoll,
  findRunsAwaitingSubmission,
  heartbeat,
  promoteToActive,
  reclaimStaleRuns,
  recordPoll,
  recordSubmission,
  timeOutExhaustedPolls,
  toConfidencePercent,
  type DueRun,
} from "./processingRuns";
import { readOriginalDocument, resolveMimeType } from "./documentSource";

export interface WorkerTickResult {
  submitted: number;
  polled: number;
  completed: number;
  failed: number;
  retriesScheduled: number;
  ocrRetriesQueued: number;
  reclaimed: { resumedPolling: number; requeued: number };
  pollTimeouts: number;
  /** Set when the tick could not run at all, e.g. no provider configured. */
  blocker: string | null;
}

const EMPTY_TICK: WorkerTickResult = {
  submitted: 0,
  polled: 0,
  completed: 0,
  failed: 0,
  retriesScheduled: 0,
  ocrRetriesQueued: 0,
  reclaimed: { resumedPolling: 0, requeued: 0 },
  pollTimeouts: 0,
  blocker: null,
};

/**
 * Structured, content-free worker logging.
 *
 * Never logs document bytes, extracted text, signed URLs, API keys, or
 * authorization headers — only identifiers, states, and sanitised codes.
 */
function log(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.log(`[DocumentWorker] ${event}`, fields);
}

function profileOf(run: DueRun): ProcessingProfile {
  return isProcessingProfile(run.profile) ? run.profile : "STANDARD";
}

function jobReference(run: DueRun): ParserJobReference {
  return {
    runId: run.id,
    externalTaskId: run.externalTaskId ?? "",
    correlationId: run.correlationId ?? run.id,
  };
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface EnqueueParseInput {
  accountId: string;
  documentId: string;
  contentSha256: string;
  profile?: ProcessingProfile;
  reason?: ProcessingReason;
  correlationId?: string;
}

/**
 * Creates the durable processing run for a document, idempotently.
 *
 * Called from the upload path and from an explicit reprocess. Returns without
 * doing any parsing work — the run sits in Postgres until a worker claims it, so
 * the caller's request finishes immediately and a process restart loses nothing.
 */
export async function enqueueDocumentParse(input: EnqueueParseInput): Promise<{
  runId: string | null;
  created: boolean;
  blocker: string | null;
}> {
  let provider: DocumentParserProvider;
  try {
    provider = getDocumentParserProvider();
  } catch (error) {
    // No provider configured is a real, reportable state — not a silent no-op.
    const message = isDocumentParserError(error)
      ? error.message
      : "The document parser provider could not be resolved.";
    log("enqueue.blocked", { documentId: input.documentId, reason: "PARSER_NOT_CONFIGURED" });
    return { runId: null, created: false, blocker: message };
  }

  const profile = input.profile ?? "STANDARD";
  const { run, created } = await createOrFindRun({
    accountId: input.accountId,
    documentId: input.documentId,
    contentSha256: input.contentSha256,
    parserProvider: provider.providerId,
    profile,
    configHash: provider.configurationHash(profile),
    reason: input.reason ?? "INITIAL",
    correlationId: input.correlationId ?? randomUUID(),
  });

  if (created) {
    await createAuditLog({
      accountId: input.accountId,
      userId: null,
      action: "document.processing.queued",
      entity: "DocumentParseVersion",
      entityId: run.id,
      metadata: {
        documentId: input.documentId,
        profile,
        reason: input.reason ?? "INITIAL",
        parserProvider: provider.providerId,
        parserIsMock: provider.isMockProvider(),
      },
      correlationId: run.correlationId,
    });
  }

  log(created ? "enqueue.created" : "enqueue.duplicate", {
    runId: run.id,
    documentId: input.documentId,
    profile,
  });
  return { runId: run.id, created, blocker: null };
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export async function runWorkerTick(): Promise<WorkerTickResult> {
  let provider: DocumentParserProvider;
  try {
    provider = getDocumentParserProvider();
  } catch (error) {
    return {
      ...EMPTY_TICK,
      blocker: isDocumentParserError(error)
        ? error.message
        : "The document parser provider could not be resolved.",
    };
  }

  const limits = readProcessingLimits();
  const result: WorkerTickResult = { ...EMPTY_TICK, reclaimed: { resumedPolling: 0, requeued: 0 } };

  // Recovery first: work abandoned by a crashed worker becomes claimable before
  // any new work is taken on, so a restart drains the backlog rather than growing it.
  result.reclaimed = await reclaimStaleRuns();
  result.pollTimeouts = await timeOutExhaustedPolls();

  for (const run of await findRunsAwaitingSubmission(limits.batchSize)) {
    const outcome = await submitRun(provider, run);
    if (outcome === "submitted") result.submitted += 1;
    else if (outcome === "retry") result.retriesScheduled += 1;
    else result.failed += 1;
  }

  for (const run of await findRunsAwaitingPoll(limits.batchSize)) {
    const outcome = await pollRun(provider, run);
    result.polled += 1;
    if (outcome.completed) result.completed += 1;
    if (outcome.failed) result.failed += 1;
    if (outcome.retryScheduled) result.retriesScheduled += 1;
    if (outcome.ocrRetryQueued) result.ocrRetriesQueued += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

async function submitRun(
  provider: DocumentParserProvider,
  run: DueRun
): Promise<"submitted" | "retry" | "failed"> {
  const profile = profileOf(run);
  const correlationId = run.correlationId ?? run.id;
  const limits = readProcessingLimits();

  try {
    await heartbeat(run.id);

    const original = await readOriginalDocument({
      fileUrl: run.document.fileUrl,
      expectedSha256: run.document.checksum,
    });

    const mimeType = resolveMimeType(run.document.mimeType, run.document.fileName);

    // Inline delivery is the default because it needs no publicly reachable URL
    // and therefore has no SSRF surface at all. Signed-url delivery is only used
    // when configured, and only ever with a Qubere-minted storage URL (asserted
    // inside the provider).
    const source =
      provider.sourceDelivery === "inline"
        ? ({
            kind: "inline" as const,
            filename: run.document.fileName,
            mimeType,
            bytes: original.bytes,
          })
        : ({
            kind: "signed-url" as const,
            filename: run.document.fileName,
            mimeType,
            url: run.document.fileUrl ?? "",
            expiresAt: new Date(Date.now() + limits.signedUrlTtlSeconds * 1000),
          });

    const ack = await provider.submit({ runId: run.id, correlationId, profile, source });

    const recorded = await recordSubmission({
      runId: run.id,
      externalTaskId: ack.externalTaskId,
      providerStatus: ack.providerStatus,
      nextPollAt: new Date(Date.now() + limits.pollInitialDelayMs),
      unsupportedOptions: ack.unsupportedOptions,
    });

    if (!recorded) {
      // Another worker submitted this run first. The provider now holds two
      // tasks for the same work; the one we just created is abandoned rather
      // than tracked, because the run points at the first one. Logged so
      // duplicate provider spend is visible rather than invisible.
      log("submit.lostRace", { runId: run.id, externalTaskId: ack.externalTaskId });
      return "submitted";
    }

    await createAuditLog({
      accountId: run.document.accountId,
      userId: null,
      action: "document.processing.submitted",
      entity: "DocumentParseVersion",
      entityId: run.id,
      metadata: {
        documentId: run.documentId,
        profile,
        parserProvider: provider.providerId,
        // The task id is an opaque provider handle, not a secret, and is the
        // only way to correlate a Qubere run with the provider's own logs.
        externalTaskId: ack.externalTaskId,
        unsupportedOptions: [...ack.unsupportedOptions],
      },
      correlationId,
    });

    log("submit.ok", { runId: run.id, profile, providerStatus: ack.providerStatus });
    return "submitted";
  } catch (error) {
    return handleRunFailure(run, "QUEUED", error, "submission");
  }
}

// ---------------------------------------------------------------------------
// Polling and completion
// ---------------------------------------------------------------------------

interface PollOutcome {
  completed: boolean;
  failed: boolean;
  retryScheduled: boolean;
  ocrRetryQueued: boolean;
}

const NO_CHANGE: PollOutcome = {
  completed: false,
  failed: false,
  retryScheduled: false,
  ocrRetryQueued: false,
};

async function pollRun(provider: DocumentParserProvider, run: DueRun): Promise<PollOutcome> {
  const from = run.status === "SUBMITTED" ? "SUBMITTED" : "POLLING";
  const profile = profileOf(run);
  const limits = readProcessingLimits();

  try {
    await heartbeat(run.id);
    const status = await provider.getStatus(jobReference(run));

    if (status.state === "POLLING") {
      await recordPoll({
        runId: run.id,
        from,
        providerStatus: status.providerStatus,
        nextPollAt: new Date(Date.now() + pollDelayMs(run.pollAttemptCount + 1, limits)),
      });
      return NO_CHANGE;
    }

    if (status.state === "FAILED") {
      const error =
        status.error ??
        new DocumentParserError(
          "PARSER_PROVIDER_ERROR",
          `The parser reported the conversion as "${status.providerStatus}".`,
          { retryable: false }
        );
      const handled = await handleRunFailure(run, from, error, "polling");
      return {
        completed: false,
        failed: handled === "failed",
        retryScheduled: handled === "retry",
        ocrRetryQueued: false,
      };
    }

    return await finishRun(provider, run, from, profile, status.providerStatus);
  } catch (error) {
    const handled = await handleRunFailure(run, from, error, "polling");
    return {
      completed: false,
      failed: handled === "failed",
      retryScheduled: handled === "retry",
      ocrRetryQueued: false,
    };
  }
}

/**
 * Retrieves the result, persists everything, and decides the run's fate.
 *
 * Ordering matters and is deliberate: artifacts are written *before* the run is
 * marked complete, so a run that says SUCCEEDED always has its evidence stored.
 * The active-version pointer moves last, and only if the quality policy accepts
 * the run and no newer run has already been accepted.
 */
async function finishRun(
  provider: DocumentParserProvider,
  run: DueRun,
  from: "SUBMITTED" | "POLLING",
  profile: ProcessingProfile,
  providerStatus: string
): Promise<PollOutcome> {
  const parsed = await provider.getResult(jobReference(run), profile);

  const quality = assessQuality({
    result: parsed.normalized,
    expectedPageCount: null,
    isOcrRetry: run.reason === "OCR_RETRY" || profile === "OCR_FALLBACK",
    usedFullPageOcr: profile === "FULL_PAGE_OCR",
  });

  const artifacts = await persistRunArtifacts({
    accountId: run.document.accountId,
    documentId: run.documentId,
    processingRunId: run.id,
    canonical: parsed.canonical,
    normalized: parsed.normalized,
    quality,
  });

  const durationMs =
    parsed.normalized.metadata.processingDurationMs ??
    (run.startedAt === null ? null : Date.now() - run.startedAt.getTime());

  // A run whose quality gate says RETRY_WITH_OCR is not a failure and not an
  // acceptable active version: it completed, its artifacts are real, and a
  // better run is expected to supersede it. It is recorded as NEEDS_REVIEW until
  // the retry succeeds, so a document is never left silently unprocessed if the
  // retry itself fails.
  const finalState: "SUCCEEDED" | "NEEDS_REVIEW" =
    quality.outcome === "PASS" || quality.outcome === "PASS_WITH_WARNINGS"
      ? "SUCCEEDED"
      : "NEEDS_REVIEW";

  const moved = await completeRun({
    runId: run.id,
    from,
    providerStatus,
    quality,
    artifacts,
    parserName: parsed.normalized.metadata.parserName,
    parserVersion: parsed.normalized.metadata.parserVersion,
    pageCount: parsed.normalized.metadata.pageCount,
    ocrUsed: parsed.normalized.metadata.ocrUsed,
    fullPageOcrUsed: parsed.normalized.metadata.fullPageOcrUsed,
    // The parser's measured score, which is the honest one on this document --
    // Docling reported 0.86 on the invoice that made this omission visible while
    // the column read null, next to an extraction run's self-reported 98.
    confidence: toConfidencePercent(parsed.normalized.metadata.parserConfidence),
    durationMs,
    warnings: parsed.normalized.warnings,
    finalState,
  });

  if (!moved) {
    // Another worker already completed this run. Duplicate completion is safe:
    // the artifacts we just wrote live under this run's own storage path, and the
    // database state is whatever the winner recorded.
    log("finish.duplicate", { runId: run.id });
    return NO_CHANGE;
  }

  let promoted = false;
  if (finalState === "SUCCEEDED" && qualifiesAsActive(quality.outcome)) {
    const promotion = await promoteToActive({
      runId: run.id,
      documentId: run.documentId,
      accountId: run.document.accountId,
    });
    promoted = promotion.promoted;
    if (!promoted) {
      log("finish.notPromoted", { runId: run.id, reason: promotion.reason });
    }
  }

  await createAuditLog({
    accountId: run.document.accountId,
    userId: null,
    action: finalState === "SUCCEEDED" ? "document.processing.completed" : "document.processing.needs_review",
    entity: "DocumentParseVersion",
    entityId: run.id,
    metadata: {
      documentId: run.documentId,
      profile,
      qualityOutcome: quality.outcome,
      qualityReasons: quality.reasons,
      pageCount: quality.pageCount,
      tableCount: quality.tableCount,
      sectionCount: quality.sectionCount,
      artifactCount: artifacts.artifacts.length,
      becameActiveVersion: promoted,
      parserProvider: provider.providerId,
      parserIsMock: provider.isMockProvider(),
    },
    correlationId: run.correlationId,
  });

  log("finish.ok", {
    runId: run.id,
    outcome: quality.outcome,
    finalState,
    promoted,
    artifacts: artifacts.artifacts.length,
  });

  let ocrRetryQueued = false;
  if (quality.outcome === "RETRY_WITH_OCR" && quality.suggestedRetryProfile !== null) {
    ocrRetryQueued = await queueOcrRetry(run, quality.suggestedRetryProfile);
  }

  if (promoted) {
    await dispatchDownstream(run);
  }

  return { completed: true, failed: false, retryScheduled: false, ocrRetryQueued };
}

/**
 * Creates a NEW run under an OCR-capable profile.
 *
 * The original run is left exactly as it is. Reprocessing never overwrites a
 * historical run's artifacts, so the weaker parse remains inspectable next to the
 * better one.
 */
async function queueOcrRetry(run: DueRun, profile: ProcessingProfile): Promise<boolean> {
  if (run.document.checksum === null) {
    log("ocrRetry.skipped", { runId: run.id, reason: "no recorded content hash" });
    return false;
  }

  const enqueued = await enqueueDocumentParse({
    accountId: run.document.accountId,
    documentId: run.documentId,
    contentSha256: run.document.checksum,
    profile,
    reason: "OCR_RETRY",
    correlationId: run.correlationId ?? undefined,
  });

  if (enqueued.created) {
    await createAuditLog({
      accountId: run.document.accountId,
      userId: null,
      action: "document.processing.ocr_retry",
      entity: "DocumentParseVersion",
      entityId: enqueued.runId ?? run.id,
      metadata: { documentId: run.documentId, supersedingRunId: run.id, profile },
      correlationId: run.correlationId,
    });
  }

  log("ocrRetry.queued", { runId: run.id, newRunId: enqueued.runId, profile, created: enqueued.created });
  return enqueued.created;
}

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

async function handleRunFailure(
  run: DueRun,
  from: ProcessingRunState,
  error: unknown,
  stage: "submission" | "polling"
): Promise<"retry" | "failed"> {
  const parserError = isDocumentParserError(error)
    ? error
    : new DocumentParserError(
        stage === "submission" ? "PARSER_SUBMISSION_FAILED" : "PARSER_PROVIDER_ERROR",
        // The underlying message is not surfaced: an unexpected exception may
        // carry a stack, a connection string, or a provider payload.
        `The document parser failed during ${stage}.`,
        { retryable: true, cause: error }
      );

  const { willRetry } = await failRun({
    runId: run.id,
    from,
    code: parserError.code,
    message: parserError.message,
    retryable: parserError.retryable,
    providerStatus: parserError.providerStatus,
  });

  await createAuditLog({
    accountId: run.document.accountId,
    userId: null,
    action: "document.processing.failed",
    entity: "DocumentParseVersion",
    entityId: run.id,
    metadata: {
      documentId: run.documentId,
      stage,
      errorCode: parserError.code,
      retryable: parserError.retryable,
      willRetry,
      attempt: run.attemptCount,
      maxAttempts: run.maxAttempts,
    },
    correlationId: run.correlationId,
    success: false,
  });

  log("failure", {
    runId: run.id,
    stage,
    errorCode: parserError.code,
    retryable: parserError.retryable,
    willRetry,
  });

  return willRetry ? "retry" : "failed";
}

// ---------------------------------------------------------------------------
// Downstream dispatch
// ---------------------------------------------------------------------------

/**
 * Records that a document is ready for classification and extraction, then runs
 * extraction against the parsed context.
 *
 * The durable event is written first and independently of the extraction, so a
 * crash between parsing and extraction loses the trigger from neither side: the
 * event stands as the record that this parse became authoritative, and the
 * extraction run is its own versioned artifact that can be re-run against the
 * same parse without reparsing.
 */
async function dispatchDownstream(run: DueRun): Promise<void> {
  const document = await db.shipmentDocument.findFirst({
    where: { id: run.documentId, accountId: run.document.accountId },
    select: { shipmentId: true },
  });

  if (document?.shipmentId === null || document?.shipmentId === undefined) {
    // A detached document has no shipment to log or extract against. The parse
    // still stands; extraction runs when the document is attached.
    log("dispatch.skipped", { runId: run.id, reason: "document is not attached to a shipment" });
    return;
  }

  const { ShipmentEventBus } = await import("@/modules/events/shipmentEventBus");
  await ShipmentEventBus.logEvent({
    shipmentId: document.shipmentId,
    eventType: "DOCUMENT_READY_FOR_CLASSIFICATION",
    payload: {
      documentId: run.documentId,
      processingRunId: run.id,
      profile: run.profile,
      correlationId: run.correlationId,
    },
    triggeredBy: "Document Processing Worker",
  });

  const { runDocumentExtraction } = await import("./classificationExtraction");
  const extraction = await runDocumentExtraction({
    accountId: run.document.accountId,
    userId: null,
    documentId: run.documentId,
    shipmentId: document.shipmentId,
    correlationId: run.correlationId,
    processingRunId: run.id,
  });

  log("dispatch.ok", {
    runId: run.id,
    shipmentId: document.shipmentId,
    extractionRan: extraction.ran,
    extractionRunId: extraction.extractionRunId,
    extractionSkippedReason: extraction.skippedReason,
  });
}
