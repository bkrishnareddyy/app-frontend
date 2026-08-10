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

  // Step 4: Dispatch Event to PG Queue and trigger background pipeline worker execution.
  // Document Intake and Document Intelligence used to also run synchronously here
  // "for real-time inspection" before the background pipeline ran the same two
  // steps again a moment later -- nothing in the client ever read the synchronous
  // result (it was only ever returned in the response body, unused), so it existed
  // purely to write a duplicate AgentDecision row per upload for both agents.
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
    pipelineResult: { status: "processing", shipmentId: targetShipmentId },
  });
}, { permission: "documents.create" });
