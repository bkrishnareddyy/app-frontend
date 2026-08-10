import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { ClassificationCaseRepository } from "@/repositories/classificationCaseRepository";
import { z } from "zod";

const paramsSchema = z.object({ caseId: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ caseId: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { caseId } = paramsVal.data;

  try {
    const caseRecord = await ClassificationCaseRepository.getById(ctx.accountId, caseId);

    if (!caseRecord) {
      return NextResponse.json({ error: "Classification case not found" }, { status: 404 });
    }

    const proposals = caseRecord.runs.flatMap((r) => r.proposals);

    return NextResponse.json({ caseId, proposals });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
