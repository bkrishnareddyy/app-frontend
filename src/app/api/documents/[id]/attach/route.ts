import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams, parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { AgentDependencyOrchestrator } from "@/modules/agents/agentDependencyOrchestrator";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });
const bodySchema = z.object({ shipmentId: z.string().min(1) });

// Attaches a (typically previously-detached) document to a shipment,
// porting over its already-extracted data as-is, then triggers the same
// dependency-aware agents a fresh upload would -- no re-extraction needed
// since extractedJson never leaves the row.
export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, bodySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { shipmentId } = bodyVal.data;

  const doc = await db.shipmentDocument.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const targetShipment = await db.shipment.findFirst({
    where: { id: shipmentId, accountId: ctx.accountId, deletedAt: null },
  });

  if (!targetShipment) {
    return NextResponse.json({ error: "Target shipment not found in this account" }, { status: 400 });
  }

  const updated = await db.shipmentDocument.update({
    where: { id },
    data: { shipmentId },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "document.attach",
    entity: "ShipmentDocument",
    entityId: id,
    metadata: { fileName: doc.fileName, previousShipmentId: doc.shipmentId, newShipmentId: shipmentId },
    success: true,
  });

  try {
    await AgentDependencyOrchestrator.processEvent({
      shipmentId,
      accountId: ctx.accountId,
      userId: ctx.userId,
      triggerEvent: "DOCUMENT_UPLOADED",
      payload: { documentId: id, fileName: doc.fileName, reattached: true },
    });
  } catch (err: any) {
    console.error("Agent orchestration failed on document attach:", err?.message || err);
  }

  return NextResponse.json({ document: updated, requestId });
});
