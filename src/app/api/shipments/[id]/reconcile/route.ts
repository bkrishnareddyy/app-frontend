import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { PipelineOrchestrator } from "@/modules/agents/pipelineOrchestrator";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().min(1),
});

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  // The orchestrator does not check ownership, so a foreign id would otherwise
  // run this tenant's agents against another tenant's shipment.
  const owned = await db.shipment.findFirst({
    where: { id, accountId: ctx.accountId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  try {
    const result = await PipelineOrchestrator.processEvent({
      shipmentId: id,
      accountId: ctx.accountId,
      userId: ctx.userId,
      triggerEvent: "RECONCILIATION_REQUESTED",
      payload: { triggerSource: "USER_MANUAL_RECONCILE" },
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("Failed to run reconciliation:", err);
    // The internal message stays in the log rather than going back to the caller.
    return NextResponse.json({ error: "Reconciliation failed" }, { status: 500 });
  }
});

