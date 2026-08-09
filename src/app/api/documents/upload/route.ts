import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { storeDocumentFile } from "@/lib/storage";
import { PgQueue } from "@/lib/queue/pgQueue";
import {
  DocumentIntakeAgent,
  DocumentType,
  agentEventBus,
} from "@/modules/intake/documentIntakeAgent";
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

  let targetShipmentId = formData.get("shipmentId") as string | null;

  if (targetShipmentId) {
    const existing = await db.shipment.findUnique({
      where: { id: targetShipmentId },
      select: { id: true },
    });
    if (!existing) {
      targetShipmentId = null;
    }
  }

  if (!targetShipmentId) {
    const activeShipment = await db.shipment.findFirst({
      where: { accountId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (activeShipment) {
      targetShipmentId = activeShipment.id;
    } else {
      const count = await db.shipment.count({ where: { accountId } });
      const shipmentNumber = `SHP-2026-${String(count + 1).padStart(6, "0")}`;
      const newShipment = await db.shipment.create({
        data: {
          accountId,
          shipmentNumber,
          importerName: "Demo Import Account",
          poReference: `PO-${Math.floor(100000 + Math.random() * 900000)}`,
          entryType: "Consumption Entry",
          incoterm: "FOB SHENZHEN",
          status: "In Progress",
          readinessScore: 85,
          riskScore: 20,
        },
      });
      targetShipmentId = newShipment.id;
    }
  }

  // Resolve user or AI document type
  const { DocumentTypeCatalog } = await import("@/modules/intake/documentTypeCatalog");
  let resolvedDocType = "Commercial Invoice";
  if (rawDocType && rawDocType !== "AUTO_DETECT") {
    resolvedDocType = rawDocType;
  } else {
    const matched = DocumentTypeCatalog.matchDocumentType(file.name);
    resolvedDocType = matched.code !== "OTHER_UNVERIFIED_DOCUMENT" ? matched.name : "Commercial Invoice";
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
        confidence: 95,
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
        confidence: 95,
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

  // Step 3: Emit background reactive event so Agent 1 is triggered via EventBus
  agentEventBus.emit("document:uploaded", agentInput);

  // Step 4: Execute Document Intake Agent & Document Intelligence Agent for synchronous real-time inspection
  const intakeResult = await DocumentIntakeAgent.execute(agentInput);

  let intelligenceResult: any = null;
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
  } catch (err: any) {
    console.warn("DocumentIntelligenceAgent execution on upload error:", err?.message || err);
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
      await PgQueue.dequeueNextJob();
      const pipelineOut = await AgentOrchestrator.runFullPipeline({
        accountId,
        userId,
        shipmentId: targetShipmentId,
        fileName: file.name,
        fileUrl: storageResult.url,
        fileBuffer,
        mimeType: file.type || "application/pdf",
      });
      await PgQueue.completeJob(job.id, pipelineOut);
    } catch (err: any) {
      console.error("[UploadPipeline] Background worker error:", err);
      await PgQueue.failJob(job.id, err?.message || String(err));
    }
  })();

  return NextResponse.json({
    success: true,
    jobId: job.id,
    shipmentId: targetShipmentId,
    orchestration: "Dispatched to Qubere Autonomous Multi-Agent Pipeline (10 Agents)",
    storage: storageResult,
    intakeResult,
    intelligenceResult,
    pipelineResult: { status: "processing", shipmentId: targetShipmentId },
  });
}, { permission: "documents.create" });
