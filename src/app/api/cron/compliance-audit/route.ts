import { NextResponse } from "next/server";
import { withPublicRoute } from "@/lib/api/auth-guards";
import { executeDailyComplianceAudit } from "@/lib/inngest/functions/dailyComplianceAudit";

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

  const result = await executeDailyComplianceAudit();

  return NextResponse.json({
    ok: true,
    totalEvaluated: result.totalEvaluated,
    totalFindingsCreated: result.totalFindingsCreated,
  });
});
