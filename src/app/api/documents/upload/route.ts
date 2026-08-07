import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { storeDocumentFile } from "@/lib/storage";
import {
  DocumentIntakeAgent,
  DocumentType,
  agentEventBus,
} from "@/modules/intake/documentIntakeAgent";
import { AgentOrchestrator } from "@/modules/agents/agentOrchestrator";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // Step 2: Associate with shipment or find default shipment
    let targetShipmentId = shipmentId;
    if (!targetShipmentId) {
      const defaultShipment = await db.shipment.findFirst({
        where: { accountId: ctx.accountId, deletedAt: null },
      });
      targetShipmentId = defaultShipment?.id || "";
    }

    if (!targetShipmentId) {
      return NextResponse.json({ error: "No target shipment found" }, { status: 404 });
    }

    // Map doc type string to enum if provided
    let docTypeOverride: DocumentType | undefined = undefined;
    if (rawDocType) {
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
      accountId: ctx.accountId,
      userId: ctx.userId,
      shipmentId: targetShipmentId,
      fileName: file.name,
      fileUrl: storageResult.url,
      fileBuffer,
      mimeType: file.type || "application/pdf",
      docTypeOverride,
    };

    // Step 3: Emit background reactive event so Agent 1 is triggered via EventBus
    agentEventBus.emit("document:uploaded", agentInput);

    // Step 4: Execute Full Autonomous Multi-Agent Pipeline (Agents 1 through 10)
    const pipelineOutput = await AgentOrchestrator.runFullPipeline({
      accountId: ctx.accountId,
      userId: ctx.userId,
      shipmentId: targetShipmentId,
      fileName: file.name,
      fileUrl: storageResult.url,
      fileBuffer,
    });

    return NextResponse.json({
      success: true,
      orchestration: "Qubere Autonomous Multi-Agent Pipeline (10 Agents)",
      storage: storageResult,
      pipelineResult: pipelineOutput,
    });
  } catch (error) {
    console.error("POST /api/documents/upload error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
