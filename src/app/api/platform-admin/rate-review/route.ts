import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { listPendingRateReviews, RATE_REVIEW_TYPES } from "@/modules/tradeRate/tradeRateReviewService";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Platform Admin only", requestId } },
      { status: 403 }
    );
  }

  const items = await listPendingRateReviews();

  const byType = Object.fromEntries(
    RATE_REVIEW_TYPES.map((type) => [type, items.filter((item) => item.type === type).length])
  );

  return NextResponse.json({
    items,
    summary: { total: items.length, byType },
    timestamp: new Date().toISOString(),
  });
});
