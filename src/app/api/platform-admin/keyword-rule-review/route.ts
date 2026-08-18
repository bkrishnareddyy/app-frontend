import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { listPendingKeywordRuleReviews } from "@/modules/complianceKeywordRules/keywordRuleReviewService";

export const GET = withAuthenticatedRoute(async ({ ctx, req, requestId }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Platform Admin only", requestId } },
      { status: 403 }
    );
  }

  const categoryParam = new URL(req.url).searchParams.get("category");
  const categories = categoryParam ? categoryParam.split(",").map((c) => c.trim()).filter(Boolean) : undefined;

  const items = await listPendingKeywordRuleReviews(categories);

  const byCategory: Record<string, number> = {};
  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
  }

  return NextResponse.json({
    items,
    summary: { total: items.length, byCategory },
    timestamp: new Date().toISOString(),
  });
});
