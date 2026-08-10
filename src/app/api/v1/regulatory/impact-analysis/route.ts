import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { ImpactAnalysisService } from "@/modules/regulatory/impactAnalysisService";

export const POST = withAuthenticatedRoute(async ({ ctx }) => {
  try {
    const result = await ImpactAnalysisService.analyzePortfolioImpact({
      accountId: ctx.accountId,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}, { write: true });
