import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const [findings, filings, suppliers, monthlySnapshots] = await Promise.all([
    db.complianceFinding.findMany({ where: { accountId: ctx.accountId } }),
    db.customsFiling.findMany({ where: { accountId: ctx.accountId } }),
    db.supplierRiskScore.findMany({ where: { accountId: ctx.accountId } }),
    db.workMetricSnapshot.findMany({
      where: { accountId: ctx.accountId, period: "MONTHLY" },
      orderBy: { date: "asc" },
      take: 6,
    }),
  ]);

  const valuationCount = findings.filter((f) => f.rule.includes("Valuation")).length;
  const htsCount = findings.filter((f) => f.rule.includes("HTS")).length;
  const assistsCount = findings.filter((f) => f.rule.includes("Assist")).length;
  const otherCount = Math.max(0, findings.length - valuationCount - htsCount - assistsCount);
  const totalForPct = findings.length || 1;
  const pct = (n: number) => Math.round((n / totalForPct) * 100);

  const telemetry = {
    totalMonitoredEntries: filings.length,
    historicalErrorsByCategory: [
      { category: "Valuation Variance", count: valuationCount, pct: pct(valuationCount) },
      { category: "HTS Override Rate", count: htsCount, pct: pct(htsCount) },
      { category: "Missing Assists", count: assistsCount, pct: pct(assistsCount) },
      { category: "Origin & PGA Discrepancies", count: otherCount, pct: pct(otherCount) },
    ],
    // Real monthly first-pass-rate history -- empty when no snapshot has been
    // recorded yet, never a fabricated series indistinguishable from real data.
    timeSeriesMonthlyAccuracy: monthlySnapshots
      .filter((s) => s.firstPassRate !== null)
      .map((s) => ({ month: s.date.toISOString().slice(0, 7), accuracyPct: s.firstPassRate })),
    topHighRiskSuppliers: suppliers.filter((s) => s.score > 40),
  };

  return NextResponse.json({ telemetry });
});
