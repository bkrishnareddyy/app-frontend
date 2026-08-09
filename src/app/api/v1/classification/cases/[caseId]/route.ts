import { NextResponse } from "next/server";
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
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch classification case" }, { status: 500 });
  }
});
