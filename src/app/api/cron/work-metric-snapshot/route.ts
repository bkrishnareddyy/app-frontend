import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { executeDailyWorkMetricSnapshot } from "@/lib/inngest/functions/dailyWorkMetricSnapshot";

export const maxDuration = 60;

function unauthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get("authorization") !== `Bearer ${cronSecret}`;
}

export const GET = withPublicRoute(async ({ req }) => {
  if (unauthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await executeDailyWorkMetricSnapshot();

  return NextResponse.json({
    ok: true,
    createdCount: result.createdCount,
  });
});
