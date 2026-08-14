import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { executeDailyComplianceAudit } from "@/lib/inngest/functions/dailyComplianceAudit";

export const maxDuration = 60;

export const GET = withCronRoute(async () => {
  const result = await executeDailyComplianceAudit();

  return NextResponse.json({
    ok: true,
    totalEvaluated: result.totalEvaluated,
    totalFindingsCreated: result.totalFindingsCreated,
  });
});
