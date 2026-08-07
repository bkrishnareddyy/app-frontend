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
    const ctx = await getAccountContext().catch(() => null);
    const accountId = ctx?.accountId || "acc_demo_default";
    const userId = ctx?.userId || "user_demo_default";

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const rawDocType = formData.get("docType") as string | null;
    const shipmentId = formData.get("shipmentId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Ensure account exists in DB for foreign key constraints
    await db.account.upsert({
      where: { id: accountId },
      update: {},
      create: {
        id: accountId,
        name: "Demo Enterprise Account",
        slug: "demo-enterprise-account",
        type: "ENTERPRISE",
        status: "ACTIVE",
      },
    });

    // Convert file to Node Buffer for Gemini Vision / Multi-modal agent processing
    const fileArrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(fileArrayBuffer);

    // Step 1: Upload file via Dual Storage Engine (Vercel Blob / Local Storage)
    const storageResult = await storeDocumentFile(file, file.name);

    // Step 2: Associate with shipment or create default shipment if missing
    let shipment = await db.shipment.findFirst({
      where: { accountId, deletedAt: null },
    });

    if (!shipment) {
      shipment = await db.shipment.create({
        data: {
          accountId,
          shipmentNumber: `SHP-TEST-${Date.now().toString().slice(-4)}`,
          status: "In Progress",
          importerName: "Acme Logistics USA",
        },
      });
    }

    const targetShipmentId = shipment.id;

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

    // Step 4: Execute Full Autonomous Multi-Agent Pipeline (Agents 1 through 10)
    const pipelineOutput = await AgentOrchestrator.runFullPipeline({
      accountId,
      userId,
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
