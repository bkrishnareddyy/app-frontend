import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { ImpactAnalysisService } from "@/modules/regulatory/impactAnalysisService";

export async function POST(req: Request) {
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const result = await ImpactAnalysisService.analyzePortfolioImpact({
      accountId: ctx!.accountId,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to execute portfolio impact analysis" }, { status: 500 });
  }
}
