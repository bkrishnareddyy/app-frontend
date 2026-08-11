/**
 * Durable processing-run repository.
 *
 * Everything about a run's identity and lifecycle lives in Postgres, never in
 * process memory: a restart, a redeploy, or a crashed worker loses no queued
 * work, no external task id, no retry state, and no polling position.
 *
 * Three invariants are enforced here rather than left to callers:
 *
 *   1. Idempotency. A run is identified by (tenant, content hash, provider,
 *      profile, config hash). A duplicate queue delivery finds the existing run
 *      instead of creating a second one, backed by a unique database constraint.
 *
 *   2. Immutability of accepted runs. A SUCCEEDED or NEEDS_REVIEW run is never
 *      transitioned again. Reprocessing creates a new run at a higher version.
 *
 *   3. Stale-run protection. A run may only become the document's active version
 *      if no newer run has already been accepted. A slow run that finishes after
 *      a newer one is persisted for audit but cannot claim the active pointer.
 */

import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DocumentParserError,
  isLegalTransition,
  QUBERE_PARSER_CONTRACT_VERSION,
  TERMINAL_RUN_STATES,
  type ParserErrorCode,
  type ProcessingProfile,
  type ProcessingReason,
  type ProcessingRunState,
} from "../parser/contracts";
import { backoffDelayMs, readProcessingLimits } from "../parser/config";
import type { QualityAssessment } from "../parser/qualityGate";
import type { ArtifactIndex } from "../parser/artifactStore";

/**
 * Derives the run idempotency key.
 *
 * The content hash is included so re-uploading a *different* file under the same
 * name produces a different run, and re-uploading the same bytes does not. The
 * config hash is included so changing a provider setting produces a new run
 * rather than colliding with a run made under the old settings.
 */
export function buildIdempotencyKey(params: {
  accountId: string;
  contentSha256: string;
  parserProvider: string;
  profile: ProcessingProfile;
  configHash: string;
}): string {
  const material = [
    params.accountId,
    params.contentSha256,
    params.parserProvider,
    params.profile,
    params.configHash,
    QUBERE_PARSER_CONTRACT_VERSION,
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export interface CreateRunInput {
  accountId: string;
  documentId: string;
  contentSha256: string;
  parserProvider: string;
  profile: ProcessingProfile;
  configHash: string;
  reason: ProcessingReason;
  correlationId: string;
  maxAttempts?: number;
}

export interface ProcessingRunRecord {
  id: string;
  documentId: string;
  accountId: string | null;
  version: number;
  status: string | null;
  profile: string | null;
  reason: string | null;
  parserProvider: string | null;
  externalTaskId: string | null;
  correlationId: string | null;
  attemptCount: number;
  maxAttempts: number;
  pollAttemptCount: number;
  startedAt: Date | null;
  createdAt: Date;
}

const RUN_SELECT = {
  id: true,
  documentId: true,
  accountId: true,
  version: true,
  status: true,
  profile: true,
  reason: true,
  parserProvider: true,
  externalTaskId: true,
  correlationId: true,
  attemptCount: true,
  maxAttempts: true,
  pollAttemptCount: true,
  startedAt: true,
  createdAt: true,
} as const;

/**
 * Creates a QUEUED run, or returns the existing run for identical work.
 *
 * `created: false` means the caller's request was a duplicate — the same tenant
 * asking for the same parse of the same bytes under the same configuration. That
 * is not an error: the caller should simply observe the run that already exists.
 */
export async function createOrFindRun(
  input: CreateRunInput
): Promise<{ run: ProcessingRunRecord; created: boolean }> {
  const idempotencyKey = buildIdempotencyKey(input);
  const limits = readProcessingLimits();

  const existing = await db.documentParseVersion.findUnique({
    where: { idempotencyKey },
    select: RUN_SELECT,
  });
  if (existing) return { run: existing, created: false };

  // Version numbers are per document and monotonic, so "which run is newer" is
  // answerable without relying on wall-clock timestamps that can tie.
  const highest = await db.documentParseVersion.aggregate({
    where: { documentId: input.documentId },
    _max: { version: true },
  });
  const nextVersion = (highest._max.version ?? 0) + 1;

  try {
    const run = await db.documentParseVersion.create({
      data: {
        documentId: input.documentId,
        accountId: input.accountId,
        version: nextVersion,
        parserProvider: input.parserProvider,
        profile: input.profile,
        reason: input.reason,
        configHash: input.configHash,
        schemaVersion: QUBERE_PARSER_CONTRACT_VERSION,
        idempotencyKey,
        status: "QUEUED" satisfies ProcessingRunState,
        queuedAt: new Date(),
        correlationId: input.correlationId,
        maxAttempts: input.maxAttempts ?? limits.maxAttempts,
        // Required by the pre-existing shape of this table. The parse has not run,
        // so there is no parser output to record yet — and no confidence either.
        rawJson: "{}",
        parserVersion: QUBERE_PARSER_CONTRACT_VERSION,
        modelVersion: input.parserProvider,
        confidence: null,
      },
      select: RUN_SELECT,
    });
    return { run, created: true };
  } catch (error) {
    // A concurrent create won the unique constraint. Its run is the one to use.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await db.documentParseVersion.findUnique({
        where: { idempotencyKey },
        select: RUN_SELECT,
      });
      if (raced) return { run: raced, created: false };
    }
    throw error;
  }
}

/**
 * Applies a state transition, refusing illegal ones and refusing to touch a run
 * that has already reached a terminal state.
 *
 * Implemented as a conditional update on the current status so two workers
 * racing on the same run cannot both apply a transition: the second finds zero
 * rows updated and learns it lost.
 */
export async function transitionRun(params: {
  runId: string;
  from: ProcessingRunState;
  to: ProcessingRunState;
  data?: Prisma.DocumentParseVersionUpdateManyMutationInput;
}): Promise<boolean> {
  if (!isLegalTransition(params.from, params.to)) {
    throw new DocumentParserError(
      "PARSER_PROVIDER_ERROR",
      `Illegal processing state transition ${params.from} -> ${params.to}.`,
      { retryable: false }
    );
  }

  const result = await db.documentParseVersion.updateMany({
    where: { id: params.runId, status: params.from },
    data: { ...params.data, status: params.to },
  });
  return result.count === 1;
}

/** Records the provider's task id the moment a submission is accepted. */
export async function recordSubmission(params: {
  runId: string;
  externalTaskId: string;
  providerStatus: string;
  nextPollAt: Date;
  unsupportedOptions: readonly string[];
}): Promise<boolean> {
  const warnings =
    params.unsupportedOptions.length === 0
      ? undefined
      : [
          {
            code: "PROVIDER_OPTION_NOT_VERIFIABLE",
            message: `The provider does not report back on: ${params.unsupportedOptions.join(", ")}. These aspects of the profile cannot be confirmed from its response.`,
            page: null,
          },
        ];

  return transitionRun({
    runId: params.runId,
    from: "QUEUED",
    to: "SUBMITTED",
    data: {
      externalTaskId: params.externalTaskId,
      providerStatus: params.providerStatus,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      nextPollAt: params.nextPollAt,
      attemptCount: { increment: 1 },
      ...(warnings === undefined ? {} : { warningsJson: warnings }),
    },
  });
}

/** Advances polling state after a poll that found the job still running. */
export async function recordPoll(params: {
  runId: string;
  from: "SUBMITTED" | "POLLING";
  providerStatus: string;
  nextPollAt: Date;
}): Promise<boolean> {
  return transitionRun({
    runId: params.runId,
    from: params.from,
    to: "POLLING",
    data: {
      providerStatus: params.providerStatus,
      lastPolledAt: new Date(),
      heartbeatAt: new Date(),
      nextPollAt: params.nextPollAt,
      pollAttemptCount: { increment: 1 },
    },
  });
}

export interface CompleteRunInput {
  runId: string;
  from: "SUBMITTED" | "POLLING";
  providerStatus: string;
  quality: QualityAssessment;
  artifacts: ArtifactIndex;
  parserName: string | null;
  parserVersion: string | null;
  pageCount: number | null;
  ocrUsed: boolean | null;
  fullPageOcrUsed: boolean | null;
  durationMs: number | null;
  warnings: ReadonlyArray<{ code: string; message: string; page: number | null }>;
  /** SUCCEEDED, or NEEDS_REVIEW when the quality gate demands a person. */
  finalState: "SUCCEEDED" | "NEEDS_REVIEW";
}

/**
 * Records a completed parse.
 *
 * `rawJson` is set to the artifact index rather than the parser payload: the
 * payload can be megabytes, and Postgres is the index, not the object store.
 * `confidence` stays null unless the parser genuinely emitted one — nothing here
 * manufactures a number to fill the column.
 */
export async function completeRun(input: CompleteRunInput): Promise<boolean> {
  return transitionRun({
    runId: input.runId,
    from: input.from,
    to: input.finalState,
    data: {
      providerStatus: input.providerStatus,
      completedAt: new Date(),
      heartbeatAt: null,
      nextPollAt: null,
      nextRetryAt: null,
      parserName: input.parserName,
      parserVersion: input.parserVersion ?? QUBERE_PARSER_CONTRACT_VERSION,
      pageCount: input.pageCount,
      ocrUsed: input.ocrUsed,
      fullPageOcrUsed: input.fullPageOcrUsed,
      durationMs: input.durationMs,
      qualityJson: input.quality as unknown as Prisma.InputJsonValue,
      artifactsJson: input.artifacts as unknown as Prisma.InputJsonValue,
      warningsJson: input.warnings as unknown as Prisma.InputJsonValue,
      rawJson: JSON.stringify(input.artifacts),
      errorCode: null,
      errorMessage: null,
      retryable: null,
    },
  });
}

/**
 * Records a failure and decides whether another attempt is due.
 *
 * A retryable failure with attempts left goes FAILED then back to QUEUED with a
 * jittered `nextRetryAt`, so the same run continues rather than a duplicate one
 * being created. A non-retryable failure, or an exhausted one, stays FAILED —
 * final failure is a real outcome and is not disguised as pending work.
 */
export async function failRun(params: {
  runId: string;
  from: ProcessingRunState;
  code: ParserErrorCode;
  message: string;
  retryable: boolean;
  providerStatus?: string;
}): Promise<{ willRetry: boolean }> {
  const limits = readProcessingLimits();
  const run = await db.documentParseVersion.findUnique({
    where: { id: params.runId },
    select: { attemptCount: true, maxAttempts: true, status: true },
  });
  if (!run) return { willRetry: false };

  const attemptsRemaining = run.attemptCount < run.maxAttempts;
  const willRetry = params.retryable && attemptsRemaining;

  const moved = await transitionRun({
    runId: params.runId,
    from: params.from,
    to: "FAILED",
    data: {
      errorCode: params.code,
      errorMessage: params.message,
      retryable: params.retryable,
      providerStatus: params.providerStatus,
      completedAt: willRetry ? null : new Date(),
      heartbeatAt: null,
      nextPollAt: null,
      nextRetryAt: willRetry
        ? new Date(
            Date.now() +
              backoffDelayMs(run.attemptCount + 1, limits.retryBaseDelayMs, limits.retryMaxDelayMs)
          )
        : null,
    },
  });
  if (!moved) return { willRetry: false };

  if (willRetry) {
    // Back to QUEUED as the same run's next attempt. The external task id is
    // cleared: the next attempt is a fresh submission, and keeping a dead task
    // id would make a later poll read someone else's job.
    await transitionRun({
      runId: params.runId,
      from: "FAILED",
      to: "QUEUED",
      data: { externalTaskId: null, pollAttemptCount: 0 },
    });
  }

  return { willRetry };
}

/**
 * Promotes a run to be the document's active version, if and only if no newer
 * run has already been accepted.
 *
 * This is the stale-run guard. Run A starts, an explicit reprocess creates run
 * B, B succeeds and becomes active, then A finally finishes. A is persisted in
 * full for audit, but this returns false for it: "completed last" is not
 * "authoritative".
 *
 * Runs inside a transaction with a re-read of the current active version so a
 * concurrent promotion cannot interleave.
 */
export async function promoteToActive(params: {
  runId: string;
  documentId: string;
  accountId: string;
}): Promise<{ promoted: boolean; reason: string }> {
  return db.$transaction(async (tx) => {
    const run = await tx.documentParseVersion.findFirst({
      where: { id: params.runId, documentId: params.documentId, accountId: params.accountId },
      select: { id: true, version: true, status: true, pageCount: true },
    });
    if (!run) return { promoted: false, reason: "The run does not belong to this document." };
    if (run.status !== "SUCCEEDED") {
      return {
        promoted: false,
        reason: `Only a SUCCEEDED run may become active; this one is ${run.status}.`,
      };
    }

    const document = await tx.shipmentDocument.findFirst({
      where: { id: params.documentId, accountId: params.accountId },
      select: { activeParseVersionId: true },
    });
    if (!document) return { promoted: false, reason: "The document does not exist for this tenant." };

    if (document.activeParseVersionId !== null) {
      const active = await tx.documentParseVersion.findUnique({
        where: { id: document.activeParseVersionId },
        select: { version: true },
      });
      if (active !== null && active.version >= run.version) {
        return {
          promoted: false,
          reason: `A newer or equal run (version ${active.version}) is already active, so this run (version ${run.version}) does not supersede it.`,
        };
      }
    }

    await tx.shipmentDocument.update({
      where: { id: params.documentId },
      data: {
        activeParseVersionId: run.id,
        ...(run.pageCount === null ? {} : { pageCount: run.pageCount }),
      },
    });

    return { promoted: true, reason: `Run version ${run.version} is now the active parse.` };
  });
}

// ---------------------------------------------------------------------------
// Due-work queries
// ---------------------------------------------------------------------------

export interface DueRun extends ProcessingRunRecord {
  document: {
    id: string;
    accountId: string;
    fileName: string;
    fileUrl: string | null;
    checksum: string | null;
    mimeType: string | null;
    byteSize: number | null;
  };
}

const DUE_RUN_SELECT = {
  ...RUN_SELECT,
  document: {
    select: {
      id: true,
      accountId: true,
      fileName: true,
      fileUrl: true,
      checksum: true,
      mimeType: true,
      byteSize: true,
    },
  },
} as const;

/** Runs waiting to be submitted (new, or a retry whose backoff has elapsed). */
export async function findRunsAwaitingSubmission(limit: number): Promise<DueRun[]> {
  const now = new Date();
  return db.documentParseVersion.findMany({
    where: {
      status: "QUEUED",
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: [{ queuedAt: "asc" }],
    take: limit,
    select: DUE_RUN_SELECT,
  });
}

/** Runs whose next poll is due. */
export async function findRunsAwaitingPoll(limit: number): Promise<DueRun[]> {
  const now = new Date();
  return db.documentParseVersion.findMany({
    where: {
      status: { in: ["SUBMITTED", "POLLING"] },
      externalTaskId: { not: null },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
    },
    orderBy: [{ nextPollAt: "asc" }],
    take: limit,
    select: DUE_RUN_SELECT,
  });
}

/**
 * Reclaims runs a worker abandoned mid-flight.
 *
 * "Abandoned" means the heartbeat stopped, which a crash, a redeploy, or a
 * network partition all produce. A reclaimed run that still has a provider task
 * id keeps polling — the provider is still working, so resubmitting would pay
 * twice. A reclaimed run with no task id goes back to QUEUED.
 */
export async function reclaimStaleRuns(): Promise<{ resumedPolling: number; requeued: number }> {
  const limits = readProcessingLimits();
  const cutoff = new Date(Date.now() - limits.staleAfterMs);

  const resumedPolling = await db.documentParseVersion.updateMany({
    where: {
      status: { in: ["SUBMITTED", "POLLING"] },
      externalTaskId: { not: null },
      heartbeatAt: { lt: cutoff },
    },
    data: { heartbeatAt: new Date(), nextPollAt: new Date() },
  });

  const requeued = await db.documentParseVersion.updateMany({
    where: {
      status: { in: ["SUBMITTED", "POLLING"] },
      externalTaskId: null,
      heartbeatAt: { lt: cutoff },
    },
    data: { status: "QUEUED", heartbeatAt: null, nextPollAt: null },
  });

  return { resumedPolling: resumedPolling.count, requeued: requeued.count };
}

/** Refreshes the lease on a run a worker is actively handling. */
export async function heartbeat(runId: string): Promise<void> {
  await db.documentParseVersion.updateMany({
    where: { id: runId },
    data: { heartbeatAt: new Date() },
  });
}

/** True when a run has reached a state that must never be transitioned again. */
export function isTerminal(status: string | null): boolean {
  return status !== null && (TERMINAL_RUN_STATES as readonly string[]).includes(status);
}

/**
 * Ends a run that exceeded its polling ceiling.
 *
 * Not silently retried: a provider that has not finished after the configured
 * number of polls is either much slower than expected or has lost the job, and
 * both deserve a visible timeout rather than an unbounded wait.
 */
export async function timeOutExhaustedPolls(): Promise<number> {
  const limits = readProcessingLimits();
  const candidates = await db.documentParseVersion.findMany({
    where: {
      status: { in: ["SUBMITTED", "POLLING"] },
      pollAttemptCount: { gte: limits.maxPollAttempts },
    },
    select: { id: true, status: true },
  });

  let timedOut = 0;
  for (const candidate of candidates) {
    // Retryable: a fresh submission may well succeed where a lost task did not.
    // `failRun` decides whether attempts remain.
    await failRun({
      runId: candidate.id,
      from: candidate.status as ProcessingRunState,
      code: "PARSER_TIMEOUT",
      message: `The parser did not complete after ${limits.maxPollAttempts} status checks.`,
      retryable: true,
    });
    timedOut += 1;
  }
  return timedOut;
}
