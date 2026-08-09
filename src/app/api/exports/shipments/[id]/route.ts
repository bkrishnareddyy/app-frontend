import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const exportShipment = await db.exportShipment.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      documents: true,
      lineItems: true,
    },
  });

  if (!exportShipment) {
    return NextResponse.json({ error: "Export shipment not found" }, { status: 404 });
  }

  return NextResponse.json({ exportShipment });
});
