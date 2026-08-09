import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { ImpactAnalysisService } from "@/modules/regulatory/impactAnalysisService";

export const POST = withAuthenticatedRoute(async ({ ctx }) => {
  try {
    const result = await ImpactAnalysisService.analyzePortfolioImpact({
      accountId: ctx.accountId,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to execute portfolio impact analysis" }, { status: 500 });
  }
});
