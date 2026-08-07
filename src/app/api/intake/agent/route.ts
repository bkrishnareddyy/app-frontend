import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { storeDocumentFile } from "@/lib/storage";
import { db } from "@/lib/db";
import { DocumentIntakeService, DocumentType } from "@/modules/intake/documentIntake.service";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = req.headers.get("content-type") || "";

    let shipmentId: string | null = null;
    let fileName: string = "document.pdf";
    let fileUrl: string = "https://storage.qubere.ai/docs/sample.pdf";
    let docTypeOverride: DocumentType | undefined = undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      shipmentId = formData.get("shipmentId") as string | null;
      const rawDocType = formData.get("docType") as string | null;

      if (rawDocType) {
        docTypeOverride = rawDocType.toUpperCase().replace(/\s+/g, "_") as DocumentType;
      }

      if (file) {
        fileName = file.name;
        const storageResult = await storeDocumentFile(file, file.name);
        fileUrl = storageResult.url;
      }
    } else {
      const json = await req.json();
      shipmentId = json.shipmentId || null;
      fileName = json.fileName || "Commercial_Invoice.pdf";
      fileUrl = json.fileUrl || "https://storage.qubere.ai/docs/invoice.pdf";
      docTypeOverride = json.docType as DocumentType | undefined;
    }

    // Resolve target shipment if not explicitly provided
    let targetShipmentId = shipmentId;
    if (!targetShipmentId) {
      const defaultShipment = await db.shipment.findFirst({
        where: { accountId: ctx.accountId, deletedAt: null },
      });
      targetShipmentId = defaultShipment?.id || "";
    }

    if (!targetShipmentId) {
      return NextResponse.json(
        { error: "No active shipment found to associate document intake packet with." },
        { status: 404 }
      );
    }

    // Invoke Document Intake Agent
    const intakeResult = await DocumentIntakeService.ingestDocumentPacket({
      accountId: ctx.accountId,
      userId: ctx.userId,
      shipmentId: targetShipmentId,
      fileName,
      fileUrl,
      docTypeOverride,
    });

    return NextResponse.json({
      success: true,
      agent: "Document Intake Agent",
      result: intakeResult,
    });
  } catch (error) {
    console.error("POST /api/intake/agent error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
