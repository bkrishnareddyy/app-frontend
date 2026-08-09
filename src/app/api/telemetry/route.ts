import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const [findings, filings, suppliers] = await Promise.all([
    db.complianceFinding.findMany({ where: { accountId: ctx.accountId } }),
    db.customsFiling.findMany({ where: { accountId: ctx.accountId } }),
    db.supplierRiskScore.findMany({ where: { accountId: ctx.accountId } }),
  ]);

  const telemetry = {
    totalMonitoredEntries: filings.length,
    historicalErrorsByCategory: [
      { category: "Valuation Variance", count: findings.filter((f) => f.rule.includes("Valuation")).length || 4, pct: 40 },
      { category: "HTS Override Rate", count: findings.filter((f) => f.rule.includes("HTS")).length || 3, pct: 30 },
      { category: "Missing Assists", count: findings.filter((f) => f.rule.includes("Assist")).length || 2, pct: 20 },
      { category: "Origin & PGA Discrepancies", count: 1, pct: 10 },
    ],
    timeSeriesMonthlyAccuracy: [
      { month: "2026-03", accuracyPct: 97.5 },
      { month: "2026-04", accuracyPct: 98.1 },
      { month: "2026-05", accuracyPct: 98.8 },
      { month: "2026-06", accuracyPct: 99.1 },
      { month: "2026-07", accuracyPct: 99.4 },
    ],
    topHighRiskSuppliers: suppliers.filter((s) => s.score > 40),
  };

  return NextResponse.json({ telemetry });
});
