import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ lineItemId: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ lineItemId: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { lineItemId } = paramsVal.data;

  const lineItem = await db.shipmentLineItem.findFirst({
    where: { id: lineItemId, accountId: ctx.accountId },
  });

  if (!lineItem) {
    return NextResponse.json({ error: "Shipment line item not found" }, { status: 404 });
  }

  const originDeterminations = await db.originDetermination.findMany({
    where: { shipmentLineItemId: lineItemId },
    include: { tradeAgreement: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ originDeterminations });
});
