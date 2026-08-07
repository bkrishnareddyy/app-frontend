import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { storeDocumentFile } from "@/lib/storage";
import { db } from "@/lib/db";
import { DocumentIntakeService, DocumentType } from "@/modules/intake/documentIntake.service";

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

      if (rawDocType && rawDocType !== "AUTO_DETECT") {
        docTypeOverride = rawDocType.toUpperCase().replace(/\s+/g, "_") as DocumentType;
      }

      if (file) {
        fileName = file.name;
        const storageResult = await storeDocumentFile(file, file.name);
        fileUrl = storageResult.url;
      }
    } else {
      const json = await req.json().catch(() => ({}));
      shipmentId = json.shipmentId || null;
      fileName = json.fileName || "Commercial_Invoice.pdf";
      fileUrl = json.fileUrl || "https://storage.qubere.ai/docs/invoice.pdf";
      docTypeOverride = json.docType as DocumentType | undefined;
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

    // Resolve target shipment if not explicitly provided
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

    // Invoke Document Intake Agent
    const result = await DocumentIntakeService.ingestDocumentPacket({
      accountId,
      userId,
      shipmentId: targetShipmentId,
      fileName,
      fileUrl,
      docTypeOverride,
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error("POST /api/intake/agent error:", error);
    return NextResponse.json(
      {
        error: "Document Intake Failed",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
