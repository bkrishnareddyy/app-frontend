import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { storeDocumentFile } from "@/lib/storage";
import { PgQueue, toJobState } from "@/lib/queue/pgQueue";
import {
  resolveTenantShipmentId,
  shipmentResolutionStatus,
  ShipmentResolutionError,
} from "@/modules/shipments/resolveShipment";
import {
  DocumentIntakeAgent,
  DocumentType,
} from "@/modules/intake/documentIntakeAgent";
import { recordUnassignedIntake } from "@/modules/intake/unassignedIntake";
import { AgentOrchestrator } from "@/modules/agents/agentOrchestrator";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const accountId = ctx.accountId;
  const userId = ctx.userId;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const rawDocType = formData.get("docType") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Convert file to Node Buffer for Gemini Vision / Multi-modal agent processing
  const fileArrayBuffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(fileArrayBuffer);

  // Step 1: Upload file via Dual Storage Engine (Vercel Blob / Local Storage)
  const storageResult = await storeDocumentFile(file, file.name);

  const shipmentId = formData.get("shipmentId") as string | null;

  let targetShipmentId: string;
  try {
    targetShipmentId = await resolveTenantShipmentId(accountId, shipmentId);
  } catch (err) {
    if (err instanceof ShipmentResolutionError) {
      if (err.code === "TARGET_NOT_DETERMINED") {
        const intake = await recordUnassignedIntake(accountId, {
          source: "document_upload",
          fileName: file.name,
          docType: rawDocType,
        });
        return NextResponse.json(
          {
            error: err.code,
            message: `${err.message} The file was stored and raised as an exception for someone to assign.`,
            exceptionId: intake.id,
            fileUrl: storageResult.url,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: shipmentResolutionStatus(err.code) }
      );
    }
    throw err;
  }

  // Resolve user or AI document type
  const { DocumentTypeCatalog } = await import("@/modules/intake/documentTypeCatalog");
  let resolvedDocType: string;
  if (rawDocType && rawDocType !== "AUTO_DETECT") {
    resolvedDocType = rawDocType;
  } else {
    resolvedDocType = DocumentTypeCatalog.matchDocumentType(file.name).name;
  }

  // Persist or find document record in database vault
  const existingDoc = await db.shipmentDocument.findFirst({
    where: {
      accountId,
      shipmentId: targetShipmentId,
      fileName: file.name,
    },
  });

  let docRecord;
  if (existingDoc) {
    docRecord = await db.shipmentDocument.update({
      where: { id: existingDoc.id },
      data: {
        docType: resolvedDocType,
        fileUrl: storageResult.url,
        checksum: storageResult.checksum,
      },
    });
  } else {
    docRecord = await db.shipmentDocument.create({
      data: {
        accountId,
        shipmentId: targetShipmentId,
        fileName: file.name,
        docType: resolvedDocType,
        fileUrl: storageResult.url,
        checksum: storageResult.checksum,
      },
    });
  }

  // Map doc type string to enum if provided
  let docTypeOverride: DocumentType | undefined = undefined;
  if (rawDocType && rawDocType !== "AUTO_DETECT") {
    const formatted = rawDocType.toUpperCase().replace(/\s+/g, "_");
    if (
      ["COMMERCIAL_INVOICE", "BILL_OF_LADING", "PACKING_LIST", "CERTIFICATE_OF_ORIGIN"].includes(
        formatted
      )
    ) {
      docTypeOverride = formatted as DocumentType;
    }
  }

  const agentInput = {
    accountId,
    userId,
    shipmentId: targetShipmentId,
    fileName: file.name,
    fileUrl: storageResult.url,
    fileBuffer,
    mimeType: file.type || "application/pdf",
    docTypeOverride,
  };

  // Step 4: Execute Document Intake Agent & Document Intelligence Agent for synchronous real-time inspection
  const intakeResult = await DocumentIntakeAgent.execute(agentInput);

  let intelligenceResult: unknown = null;
  try {
    const { DocumentIntelligenceAgent } = await import("@/modules/agents/documentIntelligenceAgent");
    intelligenceResult = await DocumentIntelligenceAgent.execute({
      accountId,
      userId,
      shipmentId: targetShipmentId,
      packetId: intakeResult.packetId,
      fileBuffer,
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      docTypeCode: intakeResult.classifications[0]?.docTypeCode,
    });
  } catch (err: unknown) {
    console.warn(
      "DocumentIntelligenceAgent execution on upload error:",
      err instanceof Error ? err.message : err
    );
  }

  // Step 5: Dispatch Event to PG Queue and trigger background pipeline worker execution
  const job = await PgQueue.enqueueJob({
    accountId,
    userId,
    shipmentId: targetShipmentId,
    totalSteps: 10,
    priority: 10, // Documents get high priority
  });

  // Immediately trigger background execution so job status advances PENDING -> PROCESSING -> COMPLETED!
  void (async () => {
    try {
      await PgQueue.claimJob(job.id);
      const pipelineOut = await AgentOrchestrator.runFullPipeline({
        accountId,
        userId,
        shipmentId: targetShipmentId,
        fileName: file.name,
        fileUrl: storageResult.url,
        fileBuffer,
        mimeType: file.type || "application/pdf",
      });
      await PgQueue.completeJob(job.id, toJobState(pipelineOut));
    } catch (err: unknown) {
      console.error("[UploadPipeline] Background worker error:", err);
      await PgQueue.failJob(job.id, err instanceof Error ? err.message : String(err));
    }
  })();

  return NextResponse.json({
    success: true,
    jobId: job.id,
    documentId: docRecord.id,
    shipmentId: targetShipmentId,
    orchestration: "Dispatched to Qubere Autonomous Multi-Agent Pipeline (10 Agents)",
    storage: storageResult,
    intakeResult,
    intelligenceResult,
    pipelineResult: { status: "processing", shipmentId: targetShipmentId },
  });
}, { permission: "documents.create" });
