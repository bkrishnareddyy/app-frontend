import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { validatePathParams, validateQueryParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { readProcessingArtifact, StorageValidationError } from "@/lib/storage";
import {
  ARTIFACT_TYPES,
  findArtifact,
  parseArtifactIndex,
} from "@/modules/documents/parser/artifactStore";

const paramsSchema = z.object({ id: z.string().min(1) });

const querySchema = z.object({
  runId: z.string().min(1),
  artifactType: z.enum(ARTIFACT_TYPES),
  /** Required for TABLE_HTML, which is per table rather than per run. */
  tableId: z.string().min(1).optional(),
});

/**
 * Streams one processing artifact back to an authorised tenant user.
 *
 * The caller names the run and artifact type; the storage location is resolved
 * from the tenant's own records, so a caller can never point this route at
 * another tenant's object or at an arbitrary host. The storage reference itself
 * is never returned, only its contents.
 *
 * Artifact access is audited: these payloads contain the full parsed contents of
 * a customs document, so who read one and when is worth recording.
 */
export const GET = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  const queryVal = validateQueryParams(req.url, querySchema, requestId);
  if ("response" in queryVal) return queryVal.response;
  const { runId, artifactType, tableId } = queryVal.data;

  // Tenancy is enforced by joining the run to a document this tenant owns.
  const run = await db.documentParseVersion.findFirst({
    where: {
      id: runId,
      documentId: paramsVal.data.id,
      document: { accountId: ctx.accountId },
    },
    select: { id: true, artifactsJson: true, document: { select: { id: true, fileName: true } } },
  });

  // 404 rather than 403, so the response does not confirm that a run belonging
  // to another tenant exists.
  if (!run) {
    return buildErrorResponse(404, "NOT_FOUND", "Processing artifact not found.", undefined, requestId);
  }

  const index = parseArtifactIndex(run.artifactsJson);
  if (index === null) {
    return buildErrorResponse(
      404,
      "NO_PARSER_ARTIFACTS",
      "This processing run stored no artifacts.",
      undefined,
      requestId
    );
  }

  const artifact = findArtifact(index, artifactType, tableId);
  if (artifact === null) {
    return buildErrorResponse(
      404,
      "ARTIFACT_NOT_FOUND",
      `This run has no ${artifactType} artifact${tableId === undefined ? "" : ` for table ${tableId}`}.`,
      undefined,
      requestId
    );
  }

  let body: Buffer;
  try {
    body = await readProcessingArtifact(artifact.storageRef);
  } catch (error) {
    if (error instanceof StorageValidationError) {
      // Logged without the reference itself.
      console.error("[documents/artifacts] untrusted artifact origin", {
        accountId: ctx.accountId,
        runId,
        artifactType,
        code: error.code,
      });
      return buildErrorResponse(
        502,
        "UNTRUSTED_STORAGE_ORIGIN",
        "The artifact's storage location is not trusted.",
        undefined,
        requestId
      );
    }
    return buildErrorResponse(
      502,
      "ARTIFACT_UNAVAILABLE",
      "The artifact could not be read from storage.",
      undefined,
      requestId
    );
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "document.artifact.accessed",
    entity: "DocumentParseVersion",
    entityId: run.id,
    metadata: {
      documentId: run.document.id,
      artifactType,
      tableId: tableId ?? null,
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
    },
    requestId,
  });

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": artifact.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(
        `${run.document.fileName}.${artifactType.toLowerCase()}`
      )}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // The artifact's own hash, so a caller can verify what it received.
      "X-Artifact-Sha256": artifact.sha256,
    },
  });
});
