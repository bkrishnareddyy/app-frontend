import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { fileName } = body;

    if (!fileName || typeof fileName !== "string" || fileName.trim() === "") {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    }

    // Verify document exists and belongs to the active tenant account
    const doc = await db.shipmentDocument.findFirst({
      where: { id: params.id, accountId: ctx.accountId },
    });

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Update document name
    const updatedDoc = await db.shipmentDocument.update({
      where: { id: params.id },
      data: {
        fileName: fileName.trim(),
      },
    });

    // Create Audit Log entry for accountability
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "document.rename",
      entity: "ShipmentDocument",
      entityId: params.id,
      metadata: {
        previousName: doc.fileName,
        newName: fileName.trim(),
      },
      success: true,
    });

    return NextResponse.json({ document: updatedDoc });
  } catch (error) {
    console.error("PATCH /api/documents/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
