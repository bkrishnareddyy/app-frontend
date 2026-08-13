import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams, parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

const bodySchema = z.object({
  // Ordered array of document IDs — position in array = displayOrder value.
  documentIds: z.array(z.string().min(1)).min(1),
});

export const POST = withAuthenticatedRoute<{ id: string }>(
  async ({ req, ctx, requestId, params }) => {
    const paramsVal = validatePathParams(params, paramsSchema, requestId);
    if ("response" in paramsVal) return paramsVal.response;
    const { id: shipmentId } = paramsVal.data;

    const body = await parseAndValidateBody(req, bodySchema, requestId);
    if ("response" in body) return body.response;
    const { documentIds } = body.data;

    // Verify ownership: all documents must belong to this shipment + account.
    const docs = await db.shipmentDocument.findMany({
      where: { id: { in: documentIds }, shipmentId, accountId: ctx.accountId },
      select: { id: true },
});

    if (docs.length !== documentIds.length) {
      return NextResponse.json({ error: "One or more documents not found for this shipment" });
    }

    // Assign displayOrder based on position in the incoming array.
    await Promise.all(
      documentIds.map((docId, idx) =>
        db.shipmentDocument.update({ where: { id: docId }, data: { displayOrder: idx } })
      )
    );

    return NextResponse.json({ reordered: true, count: documentIds.length });
  
}, { permission: "shipments.manage", write: true });
