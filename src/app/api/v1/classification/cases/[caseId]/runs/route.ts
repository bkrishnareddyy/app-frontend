import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { ClassificationCaseEngine } from "@/modules/classification/classificationCaseEngine";
import { z } from "zod";

const paramsSchema = z.object({ caseId: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ caseId: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  try {
    const result = await ClassificationCaseEngine.processCase(ctx.accountId, ctx.userId, paramsVal.data.caseId);

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to process classification case" }, { status: 500 });
  }
});
