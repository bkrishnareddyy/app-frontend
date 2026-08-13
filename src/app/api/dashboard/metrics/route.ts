import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { computeAnalyticsMetrics } from "@/lib/analytics/metricComputer";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "MONTHLY";
  
  // Calculate dynamic up-to-date metrics
  const live = await computeAnalyticsMetrics(ctx.accountId);

  // Fetch cached snapshots if they exist
  const snapshots = await db.workMetricSnapshot.findMany({
    where: { accountId: ctx.accountId, period },
    orderBy: { date: "asc" },
    take: 6,
  });

  return NextResponse.json({
    live,
    snapshots: snapshots.map((s) => ({
      date: s.date.toISOString().split("T")[0],
      cyclTimeMedianHours: s.cyclTimeMedianHours,
      firstPassRate: s.firstPassRate,
      touchRate: s.touchRate,
      dutyPerEntry: s.dutyPerEntry ? Number(s.dutyPerEntry) : 0,
      openExceptions: s.openExceptions,
      filedEntries: s.filedEntries,
    })),
  });
}, { permission: "documents.read" });
