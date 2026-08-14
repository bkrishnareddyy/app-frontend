import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { executeDailyWorkMetricSnapshot } from "@/lib/inngest/functions/dailyWorkMetricSnapshot";

export const maxDuration = 60;

export const GET = withCronRoute(async () => {
  const result = await executeDailyWorkMetricSnapshot();

  return NextResponse.json({
    ok: true,
    createdCount: result.createdCount,
  });
});
