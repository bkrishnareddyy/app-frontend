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

  try {
    const classificationCase = await ClassificationCaseRepository.getById(ctx.accountId, paramsVal.data.caseId);

    if (!classificationCase) {
      return NextResponse.json({ error: "Classification case not found" }, { status: 404 });
    }

    return NextResponse.json({ classificationCase });
  } catch (error: unknown) {
    return handleApiError(error);
  }
});
