import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, DomainError } from "@/lib/api/error";
import { validatePathParams, validateQueryParams } from "@/lib/api/validation";
import { CONTEXT_PURPOSES } from "@/modules/documents/context/qubereDocumentContext";
import { buildContextForDocument } from "@/modules/documents/context/documentContextService";

const paramsSchema = z.object({ id: z.string().min(1) });

const querySchema = z.object({
  purpose: z.enum(CONTEXT_PURPOSES).default("TRADE_EXTRACTION"),
  /** Build the context from a specific historical run instead of the active one. */
  runId: z.string().min(1).optional(),
  /** Include the prompt-ready rendering. Off by default; it is large. */
  includePrompt: z.enum(["true", "false"]).default("false"),
});

/**
 * Returns the QubereDocumentContextV1 an agent would receive for this document.
 *
 * Read-only, and deliberately so: building a context reads stored artifacts and
 * writes nothing, so a prefetch cannot trigger a parse, an extraction, or an
 * exception.
 *
 * This is the contract downstream agents consume. Raw Docling JSON is never
 * returned here — the canonical parser payload is an artifact, reachable only
 * through the artifact route, and is not something a model or a browser needs.
 */
export const GET = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  const queryVal = validateQueryParams(req.url, querySchema, requestId);
  if ("response" in queryVal) return queryVal.response;

  try {
    const resolved = await buildContextForDocument({
      accountId: ctx.accountId,
      documentId: paramsVal.data.id,
      purpose: queryVal.data.purpose,
      processingRunId: queryVal.data.runId,
    });

    return NextResponse.json({
      requestId,
      processingRunId: resolved.processingRunId,
      context: resolved.context,
      // Included on request so a reviewer can see exactly what the model read.
      promptText: queryVal.data.includePrompt === "true" ? resolved.promptText : null,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return buildErrorResponse(error.status, error.code, error.message, undefined, requestId);
    }
    throw error;
  }
});
