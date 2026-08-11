/**
 * Builds a QubereDocumentContextV1 for a document's active processing run.
 *
 * The context is derived on demand from the stored normalised artifact rather
 * than cached in a column: it is a projection whose shape depends on the agent's
 * purpose and the configured budget, and a stale cached projection would be
 * indistinguishable from a fresh one.
 *
 * Every read is tenant-scoped through the document, so a caller can never reach
 * another tenant's parse by guessing a run id.
 */

import { db } from "@/lib/db";
import { DomainError } from "@/lib/api/error";
import { loadNormalizedResult, parseArtifactIndex, tableHtmlRefs } from "../parser/artifactStore";
import { readContextBudget } from "../parser/config";
import {
  buildQubereDocumentContext,
  renderContextForPrompt,
  type ContextPurpose,
  type QubereDocumentContextV1,
} from "./qubereDocumentContext";

export interface ResolvedContext {
  context: QubereDocumentContextV1;
  processingRunId: string;
  /** The prompt-ready rendering, so callers do not each re-implement it. */
  promptText: string;
}

/**
 * Returns the context for a document's active run.
 *
 * Throws a DomainError with an explicit code when the document has no accepted
 * parse — "not parsed yet" and "parsed but empty" are different answers and the
 * caller needs to be able to tell them apart.
 */
export async function buildContextForDocument(params: {
  accountId: string;
  documentId: string;
  purpose: ContextPurpose;
  /** Use a specific historical run instead of the active one. */
  processingRunId?: string;
}): Promise<ResolvedContext> {
  const document = await db.shipmentDocument.findFirst({
    where: { id: params.documentId, accountId: params.accountId },
    select: {
      id: true,
      fileName: true,
      docType: true,
      activeParseVersionId: true,
    },
  });

  if (!document) {
    // 404 rather than 403: telling a caller that a document exists in another
    // tenant is itself a disclosure.
    throw new DomainError("Document not found.", "NOT_FOUND", 404);
  }

  const runId = params.processingRunId ?? document.activeParseVersionId;
  if (runId === null || runId === undefined) {
    throw new DomainError(
      "This document has no accepted parse yet, so no document context can be built.",
      "NO_ACTIVE_PROCESSING_RUN",
      409
    );
  }

  const run = await db.documentParseVersion.findFirst({
    where: { id: runId, documentId: document.id },
    select: { id: true, status: true, artifactsJson: true, profile: true },
  });

  if (!run) {
    throw new DomainError("Processing run not found for this document.", "NOT_FOUND", 404);
  }

  const index = parseArtifactIndex(run.artifactsJson);
  if (index === null) {
    throw new DomainError(
      `Processing run ${run.id} stored no parser artifacts${
        run.status === null ? "" : ` (status ${run.status})`
      }, so no document context can be built from it.`,
      "NO_PARSER_ARTIFACTS",
      409
    );
  }

  const normalized = await loadNormalizedResult(index);

  const context = buildQubereDocumentContext({
    documentId: document.id,
    filename: document.fileName,
    documentType: document.docType,
    // Document role is not yet a first-class field on this model; reported as
    // unknown rather than guessed from the type.
    documentRole: null,
    processingRunId: run.id,
    result: normalized,
    purpose: params.purpose,
    budget: readContextBudget(),
    tableHtmlRefs: tableHtmlRefs(index),
  });

  return { context, processingRunId: run.id, promptText: renderContextForPrompt(context) };
}
