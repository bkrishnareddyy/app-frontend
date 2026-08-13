import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { ClassificationCaseEngine } from "@/modules/classification/classificationCaseEngine";
import { z } from "zod";

const paramsSchema = z.object({ caseId: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ caseId: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  try {
    // A-2: returns { runId, status: "QUEUED" } immediately; processing runs in the background
    const result = await ClassificationCaseEngine.triggerRun(
      ctx.accountId,
      ctx.userId,
      paramsVal.data.caseId
    );
    return NextResponse.json(result, { status: 202 });
  } catch (error: unknown) {
    return handleApiError(error);
  }

}, { permission: "classification.create", write: true });
