import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { storeDocumentFile } from "@/lib/storage";
import { PgQueue } from "@/lib/queue/pgQueue";
import {
  DocumentIntakeAgent,
  DocumentType,
  agentEventBus,
} from "@/modules/intake/documentIntakeAgent";
import { AgentOrchestrator } from "@/modules/agents/agentOrchestrator";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext().catch(() => null);
    if (!ctx || !ctx.accountId || !ctx.userId) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Only logged-in users can test Qubere AI Agents. Please sign in." },
        { status: 401 }
      );
    }
    const accountId = ctx.accountId;
    const userId = ctx.userId;

    if (!ctx.permissions.includes("documents.create") && ctx.roleName !== "OWNER" && !ctx.isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden: Missing documents.create capability" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const rawDocType = formData.get("docType") as string | null;
    const shipmentId = formData.get("shipmentId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }



    // Convert file to Node Buffer for Gemini Vision / Multi-modal agent processing
    const fileArrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(fileArrayBuffer);

    // Step 1: Upload file via Dual Storage Engine (Vercel Blob / Local Storage)
    const storageResult = await storeDocumentFile(file, file.name);

    const targetShipmentId = formData.get("shipmentId") as string;
    
    if (!targetShipmentId) {
      return NextResponse.json({ error: "Shipment ID is required" }, { status: 400 });
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

    // Step 4: Dispatch Event to PG Queue to run Autonomous Pipeline asynchronously
    const job = await PgQueue.enqueueJob({
      accountId,
      userId,
      shipmentId: targetShipmentId,
      totalSteps: 10,
      priority: 10, // Documents get high priority
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      shipmentId: targetShipmentId,
      orchestration: "Dispatched to Qubere Autonomous Multi-Agent Pipeline (10 Agents)",
      storage: storageResult,
      pipelineResult: { status: "processing", shipmentId: targetShipmentId },
    });
  } catch (error: any) {
    console.error("POST /api/documents/upload error:", error);
    return NextResponse.json(
      {
        error: "Document Upload Failed",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
