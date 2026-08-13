import { NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { storeDocumentFile, StorageValidationError } from "@/lib/storage";
import { verifyUploadToken } from "@/lib/uploadToken";
import { PipelineOrchestrator } from "@/modules/agents/pipelineOrchestrator";
import { PgQueue, toJobState } from "@/lib/queue/pgQueue";
import { enqueueDocumentParse } from "@/modules/documents/processing/documentProcessingWorker";
import { advanceDocumentProcessing } from "@/modules/documents/processing/advanceProcessing";
import { assertParseableFormat } from "@/modules/documents/processing/documentSource";
import { isDocumentParserError } from "@/modules/documents/parser/contracts";
import { screenUploadForMalware } from "@/modules/documents/processing/malwarePolicy";

export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let tokenPayload;
  try {
    tokenPayload = await verifyUploadToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid or expired upload link" }, { status: 401 });
  }

  const { shipmentId, accountId, documentType, recipientEmail } = tokenPayload;

  const shipment = await db.shipment.findFirst({
    where: { id: shipmentId, accountId },
    select: { id: true },
  });
  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  // Derive a userId for pipeline attribution — use the oldest account member.
  const membership = await db.accountMembership.findFirst({
    where: { accountId, deletedAt: null },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  const userId = membership?.userId ?? accountId;

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());

  try {
    assertParseableFormat(fileBuffer);
  } catch (error) {
    if (isDocumentParserError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const scan = await screenUploadForMalware({
    fileName: file.name,
    byteSize: file.size,
    bytes: fileBuffer,
  });
  if (scan.verdict === "QUARANTINE") {
    return NextResponse.json({ error: scan.reason }, { status: 422 });
  }

  let storageResult;
  try {
    storageResult = await storeDocumentFile(file, file.name);
  } catch (error) {
    if (error instanceof StorageValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const correlationId = randomUUID();
  const docRecord = await db.shipmentDocument.create({
    data: {
      accountId,
      shipmentId,
      fileName: file.name,
      docType: documentType,
      fileUrl: storageResult.url,
      checksum: storageResult.checksum,
      byteSize: file.size,
      mimeType: file.type === "" ? null : file.type,
      status: "Received",
      source: "EMAIL_REQUEST",
    },
  });

  const job = await PgQueue.enqueueJob({ accountId, userId, shipmentId, totalSteps: 10, priority: 8 });

  after(async () => {
    try {
      await PgQueue.claimJob(job.id);
      const pipelineOut = await PipelineOrchestrator.processEvent({
        accountId,
        userId,
        shipmentId,
        jobId: job.id,
        triggerEvent: "DOCUMENT_UPLOADED",
        payload: {
          documentId: docRecord.id,
          fileName: file.name,
          fileUrl: storageResult.url,
          fileBuffer,
          mimeType: file.type || "application/pdf",
          docTypeOverride: documentType,
        },
      });
      await PgQueue.completeJob(job.id, toJobState(pipelineOut));
    } catch (err) {
      await PgQueue.failJob(job.id, err instanceof Error ? err.message : String(err));
    }
  });

  const queued = await enqueueDocumentParse({
    accountId,
    documentId: docRecord.id,
    contentSha256: storageResult.checksum,
    profile: "STANDARD",
    reason: "INITIAL",
    correlationId,
  });
  if (queued.blocker === null) {
    advanceDocumentProcessing({ reason: "upload.token" });
  }

  return NextResponse.json({
    status: "ACCEPTED",
    documentId: docRecord.id,
    recipientEmail,
    documentType,
  }, { status: 202 });
}
