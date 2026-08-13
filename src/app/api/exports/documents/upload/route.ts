import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { exportShipmentId, docType, fileName } = body;

  if (!exportShipmentId || !fileName) {
    return NextResponse.json({ error: "exportShipmentId and fileName are required" });
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
    source: "UI",
    metadata: { fileName },
  });

  return NextResponse.json({ exportDocument: exportDoc }, { status: 201 });

}, { permission: "documents.create", write: true });
