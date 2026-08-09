import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { AgentDependencyOrchestrator } from "@/modules/agents/agentDependencyOrchestrator";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().min(1),
});

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  try {
    const result = await AgentDependencyOrchestrator.processEvent({
      shipmentId: id,
      accountId: ctx.accountId,
      userId: ctx.userId,
      triggerEvent: "RECONCILIATION_REQUESTED",
      payload: { triggerSource: "USER_MANUAL_RECONCILE" },
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Failed to run reconciliation:", err);
    return NextResponse.json({ error: err.message || "Reconciliation failed" }, { status: 500 });
  }
});
