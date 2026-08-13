import { NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { db } from "@/lib/db";
import { storeDocumentFile, StorageValidationError } from "@/lib/storage";
import { createAuditLog } from "@/lib/audit";
import {
  resolveTenantShipmentId,
  shipmentResolutionStatus,
  ShipmentResolutionError,
} from "@/modules/shipments/resolveShipment";
import { PipelineOrchestrator } from "@/modules/agents/pipelineOrchestrator";
import { PgQueue, toJobState } from "@/lib/queue/pgQueue";
import { enqueueDocumentParse } from "@/modules/documents/processing/documentProcessingWorker";
import { advanceDocumentProcessing } from "@/modules/documents/processing/advanceProcessing";
import { assertParseableFormat } from "@/modules/documents/processing/documentSource";
import { isDocumentParserError } from "@/modules/documents/parser/contracts";
import { screenUploadForMalware } from "@/modules/documents/processing/malwarePolicy";

/**
 * Accepts a trade document and queues it for processing.
 *
 * This request does no parsing. It validates the file, stores the immutable
 * original, records its hash/size/type, creates exactly one durable processing
 * run, writes an audit event, and returns 202. Everything expensive — the parser
 * provider call, polling, artifact persistence, the quality gate, classification
 * and extraction — happens in the document worker against durable Postgres state,
 * so a slow or unavailable parser cannot make an upload slow or lossy.
 *
 * Previously this route ran Gemini vision on the raw buffer and kicked off a
 * ten-agent pipeline inline, inside the user's request.
 */

// The 202 is sent long before this elapses. The budget exists for the `after()`
// drain that follows it, which is what actually gets the document to the parser
// on a host where cron only runs daily. 60s is the Hobby ceiling.
export const maxDuration = 60;

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const accountId = ctx.accountId;
  const userId = ctx.userId;
  const correlationId = randomUUID();

  const formData = await req.formData();
  const file = formData.get("file");
  const rawDocType = formData.get("docType");

  if (!(file instanceof File)) {
    return buildErrorResponse(400, "NO_FILE", "No file was provided.", undefined, requestId);
  }
  if (file.size === 0) {
    return buildErrorResponse(400, "EMPTY_FILE", "The uploaded file is empty.", undefined, requestId);
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());

  // Signature-level validation, on top of the extension/MIME allowlist that
  // `storeDocumentFile` enforces. An encrypted or truncated PDF is rejected here
  // rather than becoming a processing run that can never succeed.
  try {
    assertParseableFormat(fileBuffer);
  } catch (error) {
    if (isDocumentParserError(error)) {
      return buildErrorResponse(400, error.code, error.message, undefined, requestId);
    }
    throw error;
  }

  // Malware policy. There is no scanner wired up in this build; the policy hook
  // reports that honestly and quarantines rather than pretending a scan passed.
  const scan = await screenUploadForMalware({
    fileName: file.name,
    byteSize: file.size,
    bytes: fileBuffer,
});
  if (scan.verdict === "QUARANTINE") {
    await createAuditLog({
      accountId,
      userId,
      action: "document.upload.quarantined",
      entity: "ShipmentDocument",
      entityId: "unpersisted",
      source: "UI",
      metadata: { fileName: file.name, byteSize: file.size, reason: scan.reason },
      correlationId,
      requestId,
      success: false,
    });
    return buildErrorResponse(
      422,
      "MALWARE_QUARANTINED",
      scan.reason,
      undefined,
      requestId
    );
  }

  let storageResult;
  try {
    storageResult = await storeDocumentFile(file, file.name);
  } catch (error) {
    if (error instanceof StorageValidationError) {
      return buildErrorResponse(400, error.code, error.message, undefined, requestId);
    }
    throw error;
  }

  const shipmentIdParam = typeof formData.get("shipmentId") === "string" && (formData.get("shipmentId") as string).trim()
    ? (formData.get("shipmentId") as string).trim()
    : null;

  let targetShipmentId: string | null = null;
  if (shipmentIdParam) {
    try {
      targetShipmentId = await resolveTenantShipmentId(accountId, shipmentIdParam);
    } catch (err) {
      if (err instanceof ShipmentResolutionError) {
        return NextResponse.json({ error: err.code, message: err.message, requestId },
          { status: shipmentResolutionStatus(err.code) }
        );
      }
      throw err;
    }
  }

  const { DocumentTypeCatalog } = await import("@/modules/intake/documentTypeCatalog");
  const declaredDocType = typeof rawDocType === "string" ? rawDocType : null;
  const resolvedDocType =
    declaredDocType !== null && declaredDocType !== "AUTO_DETECT"
      ? declaredDocType
      : // Filename matching is a placeholder until the classifier runs against the
        // parsed document; the classifier's result is what the document ends up with.
        DocumentTypeCatalog.matchDocumentType(file.name).name;

  const existingDoc = targetShipmentId
    ? await db.shipmentDocument.findFirst({
        where: { accountId, shipmentId: targetShipmentId, fileName: file.name },
      })
    : await db.shipmentDocument.findFirst({
        where: { accountId, shipmentId: null, fileName: file.name },
      });

  // Superset of what upstream wrote: the original's size and media type are
  // recorded alongside its SHA-256 so the immutable original is fully described.
  const documentFields = {
    docType: resolvedDocType,
    fileUrl: storageResult.url,
    checksum: storageResult.checksum,
    byteSize: file.size,
    mimeType: file.type === "" ? null : file.type,
    status: targetShipmentId ? "Received" : "Parked",
  };

  const docRecord = existingDoc
    ? await db.shipmentDocument.update({ where: { id: existingDoc.id }, data: documentFields })
    : await db.shipmentDocument.create({
        data: { accountId, shipmentId: targetShipmentId, fileName: file.name, ...documentFields },
      });

  await createAuditLog({
    accountId,
    userId,
    action: targetShipmentId
      ? existingDoc ? "document.upload.replaced" : "document.upload.completed"
      : "document.upload.parked",
    entity: "ShipmentDocument",
    entityId: docRecord.id,
    source: "UI",
    metadata: {
      fileName: file.name,
      docType: resolvedDocType,
      byteSize: file.size,
      sha256: storageResult.checksum,
      mimeType: file.type === "" ? null : file.type,
      storageProvider: storageResult.provider,
      shipmentId: targetShipmentId,
      malwareScan: scan.verdict,
      parked: !targetShipmentId,
    },
    correlationId,
    requestId,
  });

  // If the document is unattached (no shipment ID specified), we park it in
  // the document library without running extraction/pipeline processing.
  if (!targetShipmentId) {
    return NextResponse.json({
      status: "PARKED",
      parked: true,
      documentId: docRecord.id,
      fileName: file.name,
      docType: resolvedDocType,
      message: "Document stored in document library without attachment. Attach to a shipment to run extraction.",
      requestId,
    });
  }

  // Two independent pieces of work are dispatched here, and both matter:
  //
  // 1. The agent pipeline, which writes the AgentDecision rows the Decisions
  //    screen and the document Field Review tab render. Kept exactly as upstream
  //    wrote it, including the fire-and-forget dispatch.
  // 2. The durable Docling processing run, which parses the document into
  //    evidence-backed artifacts.
  const job = await PgQueue.enqueueJob({
    accountId,
    userId,
    shipmentId: targetShipmentId,
    totalSteps: 10,
    priority: 10, // Documents get high priority
  });

  // Run the agent pipeline after the 202 response is flushed. `after()` tells
  // Next.js to keep this serverless invocation alive until the callback settles,
  // preventing the fire-and-forget from being killed mid-execution.
  after(async () => {
    try {
      await PgQueue.claimJob(job.id);
      const pipelineOut = await PipelineOrchestrator.processEvent({
        accountId,
        userId,
        shipmentId: targetShipmentId,
        jobId: job.id,
        triggerEvent: "DOCUMENT_UPLOADED",
        payload: {
          documentId: docRecord.id,
          fileName: file.name,
          fileUrl: storageResult.url,
          fileBuffer,
          mimeType: file.type || "application/pdf",
          docTypeOverride: resolvedDocType,
        },
      });
      await PgQueue.completeJob(job.id, toJobState(pipelineOut));
    } catch (err: unknown) {
      console.error("[UploadPipeline] Background worker error:", err);
      await PgQueue.failJob(job.id, err instanceof Error ? err.message : String(err));
    }
  });

  // Exactly one durable processing run per (tenant, content, provider, profile,
  // config). Re-uploading identical bytes returns the existing run instead of
  // paying the provider twice.
  const queued = await enqueueDocumentParse({
    accountId,
    documentId: docRecord.id,
    contentSha256: storageResult.checksum,
    profile: "STANDARD",
    reason: "INITIAL",
    correlationId,
  });

  if (queued.blocker === null) {
    advanceDocumentProcessing({ reason: "document.upload" });
  }

  await createAuditLog({
    accountId,
    userId,
    action: "DOCUMENT_UPLOADED",
    entity: "ShipmentDocument",
    entityId: docRecord.id,
    source: "UI",
    metadata: {
      fileName: file.name,
      docType: resolvedDocType,
      shipmentId: targetShipmentId,
      correlationId,
      requestId,
    },
    requestId,
  });

  return NextResponse.json(
    {
      status: "ACCEPTED",
      requestId,
      correlationId,
      documentId: docRecord.id,
      shipmentId: targetShipmentId,
      docType: resolvedDocType,
      fileName: file.name,
      jobId: job.id,
      processingRunId: queued.runId,
      malwareScan: { verdict: scan.verdict, detail: scan.reason },
    },
    { status: 202 }
  );

}, { permission: "documents.create", write: true });
