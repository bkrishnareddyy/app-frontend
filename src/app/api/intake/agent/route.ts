import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { DocumentType } from "@/modules/intake/documentIntake.service";
import { storeDocumentFile } from "@/lib/storage";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const accountId = ctx.accountId;
  const userId = ctx.userId;

  const contentType = req.headers.get("content-type") || "";

  let shipmentId: string | null = null;
  let fileName: string = "document.pdf";
  let fileUrl: string = "https://storage.qubere.ai/docs/sample.pdf";
  let docTypeOverride: DocumentType | undefined = undefined;

  let fileBuffer: Buffer | undefined = undefined;

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
      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
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

  let targetShipmentId = shipmentId;

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

  // Invoke Document Intake Agent directly with fileBuffer
  const { DocumentIntakeAgent } = await import("@/modules/intake/documentIntakeAgent");
  const result = await DocumentIntakeAgent.execute({
    accountId,
    userId,
    shipmentId: targetShipmentId,
    fileName,
    fileUrl,
    fileBuffer,
    docTypeOverride,
  });

  return NextResponse.json({
    success: true,
    result,
  });
});
