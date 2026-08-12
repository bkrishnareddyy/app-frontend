import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { parseArtifactIndex } from "@/modules/documents/parser/artifactStore";
import { parserConfigurationReport } from "@/modules/documents/parser/config";
import { qualityAssessmentSchema } from "@/modules/documents/parser/qualityGate";
import { advanceDocumentProcessing } from "@/modules/documents/processing/advanceProcessing";

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * Processing history for a document.
 *
 * Read-only. Every historical run is listed, including superseded and failed
 * ones, because a document that needed three attempts is a different document
 * from one that parsed cleanly, and hiding the earlier attempts would hide that.
 *
 * Artifact storage locations are never returned — only which artifact types
 * exist, their sizes and their hashes. A storage URL in a JSON response is a
 * storage credential leak waiting to happen; artifacts are fetched through the
 * tenant-scoped artifact route instead.
 *
 * Read-only from the caller's point of view, but polling it also advances the
 * pipeline: on a serverless host with a daily cron, somebody watching a document
 * convert is the most reliable signal that the work is worth doing now. The
 * drain runs after the response, so this response describes the state as it was
 * read and the next poll sees the progress.
 */

// Covers the `after()` drain below, not the read, which is a handful of queries.
export const maxDuration = 60;

/**
 * Collapses a burst of polls on one warm instance into a single drain. Slightly
 * under the 5s cadence a polling client would use, so a steady poll still gets
 * a drain each time rather than every other time.
 */
const READ_DRAIN_MIN_INTERVAL_MS = 4_000;

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  // accountId is part of the lookup, not a check applied afterwards.
  const document = await db.shipmentDocument.findFirst({
    where: { id: paramsVal.data.id, accountId: ctx.accountId },
    select: {
      id: true,
      fileName: true,
      docType: true,
      checksum: true,
      byteSize: true,
      mimeType: true,
      pageCount: true,
      activeParseVersionId: true,
      createdAt: true,
    },
  });

  if (!document) {
    return buildErrorResponse(404, "NOT_FOUND", "Document not found.", undefined, requestId);
  }

  const runs = await db.documentParseVersion.findMany({
    where: { documentId: document.id },
    orderBy: [{ version: "desc" }],
    select: {
      id: true,
      version: true,
      status: true,
      profile: true,
      reason: true,
      parserProvider: true,
      parserName: true,
      parserVersion: true,
      providerStatus: true,
      externalTaskId: true,
      attemptCount: true,
      maxAttempts: true,
      pollAttemptCount: true,
      queuedAt: true,
      startedAt: true,
      completedAt: true,
      nextRetryAt: true,
      nextPollAt: true,
      lastPolledAt: true,
      durationMs: true,
      pageCount: true,
      ocrUsed: true,
      fullPageOcrUsed: true,
      errorCode: true,
      errorMessage: true,
      retryable: true,
      warningsJson: true,
      qualityJson: true,
      artifactsJson: true,
      correlationId: true,
      createdAt: true,
    },
  });

  const configuration = parserConfigurationReport();

  // Only when this document actually has something in flight. A poll against a
  // finished document should cost a read and nothing more.
  const inFlight = runs.some(
    (run) => run.status === "QUEUED" || run.status === "SUBMITTED" || run.status === "POLLING"
  );
  if (inFlight) {
    advanceDocumentProcessing({
      reason: "document.processing.poll",
      minIntervalMs: READ_DRAIN_MIN_INTERVAL_MS,
    });
  }

  return NextResponse.json({
    requestId,
    document: {
      id: document.id,
      fileName: document.fileName,
      docType: document.docType,
      pageCount: document.pageCount,
      uploadedAt: document.createdAt,
      original: {
        sha256: document.checksum,
        byteSize: document.byteSize,
        mimeType: document.mimeType,
      },
      activeProcessingRunId: document.activeParseVersionId,
    },
    parser: {
      provider: configuration.provider,
      configured: configuration.configured,
      isMock: configuration.mock,
      blocker: configuration.blocker,
    },
    runs: runs.map((run) => {
      const index = parseArtifactIndex(run.artifactsJson);
      const quality = qualityAssessmentSchema.safeParse(run.qualityJson);
      return {
        id: run.id,
        version: run.version,
        isActive: run.id === document.activeParseVersionId,
        status: run.status,
        profile: run.profile,
        reason: run.reason,
        parser: {
          provider: run.parserProvider,
          name: run.parserName,
          // Null is the honest answer when the hosted API does not expose it.
          version: run.parserVersion,
          providerStatus: run.providerStatus,
          externalTaskId: run.externalTaskId,
        },
        attempts: {
          used: run.attemptCount,
          max: run.maxAttempts,
          polls: run.pollAttemptCount,
          nextRetryAt: run.nextRetryAt,
          nextPollAt: run.nextPollAt,
          lastPolledAt: run.lastPolledAt,
        },
        timing: {
          queuedAt: run.queuedAt,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          durationMs: run.durationMs,
        },
        parse: {
          pageCount: run.pageCount,
          ocrUsed: run.ocrUsed,
          fullPageOcrUsed: run.fullPageOcrUsed,
        },
        error:
          run.errorCode === null
            ? null
            : { code: run.errorCode, message: run.errorMessage, retryable: run.retryable },
        warnings: run.warningsJson ?? [],
        quality: quality.success ? quality.data : null,
        artifacts:
          index === null
            ? []
            : index.artifacts.map((artifact) => ({
                artifactType: artifact.artifactType,
                tableId: artifact.tableId,
                mimeType: artifact.mimeType,
                byteSize: artifact.byteSize,
                sha256: artifact.sha256,
                schemaVersion: artifact.schemaVersion,
                createdAt: artifact.createdAt,
              })),
        correlationId: run.correlationId,
        createdAt: run.createdAt,
      };
    }),
  });
});
