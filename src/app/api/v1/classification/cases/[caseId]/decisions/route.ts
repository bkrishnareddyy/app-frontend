import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { ClassificationCaseEngine } from "@/modules/classification/classificationCaseEngine";
import { z } from "zod";

const paramsSchema = z.object({ caseId: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ caseId: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { caseId } = paramsVal.data;

  try {
    const body = await req.json();
    const { proposalId, approvedHtsNodeId, decisionStatus, rationale, overrideReason } = body;

    if (!approvedHtsNodeId || !decisionStatus || !rationale) {
      return NextResponse.json({ error: "approvedHtsNodeId, decisionStatus, and rationale are required" }, { status: 400 });
    }

    const decision = await ClassificationCaseEngine.recordDecision({
      accountId: ctx.accountId,
      userId: ctx.userId,
      caseId,
      proposalId,
      approvedHtsNodeId,
      decisionStatus,
      rationale,
      overrideReason,
    });

    return NextResponse.json({ decision }, { status: 201 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}, { write: true });
