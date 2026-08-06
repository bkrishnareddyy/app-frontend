import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { exportShipmentId, docType, fileName } = body;

    if (!exportShipmentId || !fileName) {
      return NextResponse.json({ error: "exportShipmentId and fileName are required" }, { status: 400 });
    }

    const exportDoc = await db.exportDocument.create({
      data: {
        exportShipmentId,
        accountId: ctx.accountId,
        docType: docType || "Export Declaration",
        fileName,
        fileUrl: `/uploads/exports/${fileName}`,
        status: "Verified",
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "export.document_upload",
      entity: "ExportDocument",
      entityId: exportDoc.id,
      metadata: { fileName },
    });

    return NextResponse.json({ exportDocument: exportDoc }, { status: 201 });
  } catch (error) {
    console.error("POST /api/exports/documents/upload error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
