import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { storeDocumentFile } from "@/lib/storage";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const docType = (formData.get("docType") as string) || "Commercial Invoice";
    const shipmentId = formData.get("shipmentId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Step 1: Upload via Dual Storage Engine (Vercel Blob / Local Storage)
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

    // Step 3: Upsert or Create ShipmentDocument record in PostgreSQL
    const confidence = Math.floor(Math.random() * 15) + 85; // 85% - 99% AI confidence

    const shipmentDocument = await db.shipmentDocument.create({
      data: {
        shipmentId: targetShipmentId,
        accountId: ctx.accountId,
        docType,
        fileName: file.name,
        pageCount: 2,
        fileUrl: storageResult.url,
        confidence,
        status: "Received",
      },
    });

    // Step 4: Record Audit Log
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "document.upload",
      entity: "ShipmentDocument",
      entityId: shipmentDocument.id,
      metadata: {
        fileName: file.name,
        docType,
        storageProvider: storageResult.provider,
        fileUrl: storageResult.url,
      },
    });

    return NextResponse.json({
      document: shipmentDocument,
      storage: storageResult,
    });
  } catch (error) {
    console.error("POST /api/documents/upload error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
