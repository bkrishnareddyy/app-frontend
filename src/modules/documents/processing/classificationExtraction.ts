/**
 * Runs classification and extraction over a parsed document.
 *
 * Two properties matter here and are enforced rather than assumed:
 *
 *   1. Agents read a QubereDocumentContextV1, not raw parser JSON and not the
 *      raw bytes when a parse exists. That keeps the prompt bounded and keeps the
 *      provider's schema out of the agent layer.
 *
 *   2. An agent run is versioned independently of the parse it read. The parse is
 *      immutable evidence; the agent's reading of it is a separate, re-runnable
 *      opinion, recorded as its own immutable run with the model, prompt, schema,
 *      and context versions that produced it.
 *
 * Parser artifacts are never modified by any of this.
 */

import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { buildContextForDocument } from "../context/documentContextService";
import { QUBERE_DOCUMENT_CONTEXT_VERSION } from "../context/qubereDocumentContext";

/** Version of the extraction contract this module writes. Bump on schema change. */
export const EXTRACTION_SCHEMA_VERSION = "qubere.extraction/1";
const EXTRACTOR_NAME = "Document Intelligence Agent";

export interface RunExtractionInput {
  accountId: string;
  userId: string | null;
  documentId: string;
  shipmentId: string;
  correlationId: string | null;
  /** Set when this ran off a specific parse. Null when no parse exists. */
  processingRunId: string | null;
}

export interface RunExtractionResult {
  ran: boolean;
  usedParsedContext: boolean;
  extractionRunId: string | null;
  /** Why it did not run, when it did not. */
  skippedReason: string | null;
}

/**
 * Executes extraction against the document's active parse.
 *
 * When no parse exists, this reports that and does not run: guessing at a
 * document nobody has read is how fabricated customs facts get created. The
 * on-demand extraction route retains its own raw-bytes path for documents
 * uploaded before parsing was configured.
 */
export async function runDocumentExtraction(
  input: RunExtractionInput
): Promise<RunExtractionResult> {
  const startedAt = new Date();

  let promptText: string;
  let parserProvider: string;
  let parserProfile: string;
  let truncated: boolean;
  let processingRunId: string;

  try {
    const resolved = await buildContextForDocument({
      accountId: input.accountId,
      documentId: input.documentId,
      purpose: "TRADE_EXTRACTION",
      processingRunId: input.processingRunId ?? undefined,
    });
    promptText = resolved.promptText;
    parserProvider = resolved.context.parser.provider;
    parserProfile = resolved.context.parser.profile;
    truncated = resolved.context.budget.truncated;
    processingRunId = resolved.processingRunId;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The document context could not be built.";
    return { ran: false, usedParsedContext: false, extractionRunId: null, skippedReason: reason };
  }

  // The immutable agent run. Written before execution so a crash mid-extraction
  // leaves a RUNNING record rather than no record at all.
  const executionRecord = await db.agentExecutionRecord.create({
    data: {
      // Tenant-scoped so this run is reachable by the same account filter as
      // every other agent execution.
      accountId: input.accountId,
      shipmentId: input.shipmentId,
      agentName: EXTRACTOR_NAME,
      triggerEvent: "DOCUMENT_READY_FOR_CLASSIFICATION",
      invokedBy: "Document Processing Worker",
      status: "RUNNING",
      modelVersion: process.env.GEMINI_MODEL || "gemini-3.6-flash",
      runId: input.correlationId,
      startedAt,
    },
    select: { id: true },
  });

  try {
    const { DocumentIntelligenceAgent } = await import("@/modules/agents/documentIntelligenceAgent");
    const output = await DocumentIntelligenceAgent.execute({
      accountId: input.accountId,
      userId: input.userId ?? "SYSTEM",
      shipmentId: input.shipmentId,
      packetId: `pkt_run_${processingRunId.slice(0, 8)}`,
      fileName: await documentFileName(input.accountId, input.documentId),
      documentContext: {
        text: promptText,
        processingRunId,
        parserProvider,
        parserProfile,
        contextSchemaVersion: `QubereDocumentContextV${QUBERE_DOCUMENT_CONTEXT_VERSION}`,
        truncated,
      },
    });

    await db.agentExecutionRecord.update({
      where: { id: executionRecord.id },
      data: {
        status: output.extractionStatus === "failed" ? "FAILED" : "COMPLETED",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: output.extractionError ?? null,
      },
    });

    await createAuditLog({
      accountId: input.accountId,
      userId: input.userId,
      action: "document.extraction.completed",
      entity: "AgentExecutionRecord",
      entityId: executionRecord.id,
      metadata: {
        documentId: input.documentId,
        processingRunId,
        extractor: EXTRACTOR_NAME,
        extractionSchemaVersion: EXTRACTION_SCHEMA_VERSION,
        contextSchemaVersion: `QubereDocumentContextV${QUBERE_DOCUMENT_CONTEXT_VERSION}`,
        contextTruncated: truncated,
        parserProvider,
        parserProfile,
        extractionStatus: output.extractionStatus ?? "unknown",
        detectedDocType: output.detectedDocType,
        lineItemCount: output.lineItems.length,
        missingFieldCount: output.missingFields.length,
      },
      correlationId: input.correlationId,
    });

    return {
      ran: true,
      usedParsedContext: true,
      extractionRunId: executionRecord.id,
      skippedReason: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed.";
    await db.agentExecutionRecord.update({
      where: { id: executionRecord.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: message,
      },
    });

    await createAuditLog({
      accountId: input.accountId,
      userId: input.userId,
      action: "document.extraction.failed",
      entity: "AgentExecutionRecord",
      entityId: executionRecord.id,
      metadata: { documentId: input.documentId, processingRunId, extractor: EXTRACTOR_NAME },
      correlationId: input.correlationId,
      success: false,
    });

    // Not swallowed: the caller decides whether a failed extraction should stop
    // the tick. The parse itself stands regardless.
    return {
      ran: true,
      usedParsedContext: true,
      extractionRunId: executionRecord.id,
      skippedReason: message,
    };
  }
}

async function documentFileName(accountId: string, documentId: string): Promise<string> {
  const document = await db.shipmentDocument.findFirst({
    where: { id: documentId, accountId },
    select: { fileName: true },
  });
  return document?.fileName ?? "document";
}
