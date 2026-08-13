import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { DocumentType } from "@prisma/client";

const VALID_DOCUMENT_TYPES = new Set<string>(Object.values(DocumentType));

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { fileName, documentType } = body as Record<string, unknown>;

    const doc = await db.shipmentDocument.findFirst({
      where: { id: params.id, accountId: ctx.accountId },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // fileName rename
    if (fileName !== undefined) {
      if (typeof fileName !== "string" || fileName.trim() === "") {
        return NextResponse.json({ error: "fileName is required" }, { status: 400 });
      }

      const updatedDoc = await db.shipmentDocument.update({
        where: { id: params.id },
        data: { fileName: fileName.trim() },
      });

      await createAuditLog({
        accountId: ctx.accountId,
        userId: ctx.userId,
        action: "document.rename",
        entity: "ShipmentDocument",
        entityId: params.id,
        metadata: { previousName: doc.fileName, newName: fileName.trim() },
        success: true,
      });

      return NextResponse.json({ document: updatedDoc });
    }

    // B-4: Human document-type override — clears NEEDS_CLASSIFICATION status.
    if (documentType !== undefined) {
      if (typeof documentType !== "string" || !VALID_DOCUMENT_TYPES.has(documentType)) {
        return NextResponse.json(
          { error: `Invalid documentType. Valid values: ${[...VALID_DOCUMENT_TYPES].join(", ")}` },
          { status: 400 }
        );
      }

      const updatedDoc = await db.shipmentDocument.update({
        where: { id: params.id },
        data: {
          documentType: documentType as DocumentType,
          // Human confirmed the type; confidence becomes implicit 1.0 by convention.
          documentTypeConfidence: 1.0,
          // Clear the human-review flag set by the classifier.
          status: doc.status === "NEEDS_CLASSIFICATION" ? "Received" : doc.status,
        },
      });

      await createAuditLog({
        accountId: ctx.accountId,
        userId: ctx.userId,
        action: "document.classify",
        entity: "ShipmentDocument",
        entityId: params.id,
        metadata: { previousType: doc.documentType, newType: documentType },
        success: true,
      });

      return NextResponse.json({ document: updatedDoc });
    }

    return NextResponse.json({ error: "No updatable field provided" }, { status: 400 });
  } catch (error) {
    console.error("PATCH /api/documents/[id] error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
