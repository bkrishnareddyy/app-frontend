import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

// Detaches a document from its shipment without deleting the row --
// extractedJson and every other field stay intact so the document can
// later be reattached to a different shipment without redoing AI vision
// extraction.
export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const doc = await db.shipmentDocument.findFirst({
    where: { id, accountId: ctx.accountId },
});

  if (!doc) {
    return NextResponse.json({ error: "Document not found" });
  }

  if (!doc.shipmentId) {
    return NextResponse.json({ error: "Document is already detached" }, { status: 400 });
  }

  const updated = await db.shipmentDocument.update({
    where: { id },
    data: { shipmentId: null },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "document.detach",
    entity: "ShipmentDocument",
    entityId: id,
    source: "UI",
    metadata: { fileName: doc.fileName, previousShipmentId: doc.shipmentId },
    success: true,
  });

  return NextResponse.json({ document: updated, requestId });

}, { permission: "documents.create", write: true });
