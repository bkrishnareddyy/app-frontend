import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { buildAgentInvocations } from "@/app/app/shipments/[id]/agentInvocations";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const owned = await db.shipment.findFirst({
    where: { id, accountId: ctx.accountId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  const [records, logs] = await Promise.all([
    db.agentExecutionRecord.findMany({
      where: { shipmentId: id },
      orderBy: { startedAt: "desc" },
      take: 100,
    }),
    db.agentExecutionLog.findMany({
      where: { shipmentId: id },
      orderBy: { timestamp: "desc" },
      take: 200,
    }),
  ]);

  const invocations = buildAgentInvocations(records, logs);
  return NextResponse.json({ invocations });
});
