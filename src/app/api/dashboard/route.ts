import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const [filings, findings, suppliers, brokers] = await Promise.all([
    db.customsFiling.findMany({ where: { accountId: ctx.accountId } }),
    db.complianceFinding.findMany({ where: { accountId: ctx.accountId } }),
    db.supplierRiskScore.findMany({ where: { accountId: ctx.accountId } }),
    db.brokerMetrics.findMany({ where: { accountId: ctx.accountId } }),
  ]);

  const openFindings = findings.filter((f) => f.status === "Open" || f.status === "Investigating");
  const criticalFindings = openFindings.filter((f) => f.severity === "Critical" || f.severity === "High");

  const totalSuppliers = suppliers.length || 1;
  const avgSupplierRisk = Math.round(suppliers.reduce((acc, s) => acc + Number(s.score), 0) / totalSuppliers);
  // Null (not a fabricated figure) when no broker has ever been measured --
  // callers must render an explicit "no data yet" state instead of a fake accuracy.
  const avgBrokerAccuracy =
    brokers.length > 0
      ? parseFloat((brokers.reduce((acc, b) => acc + Number(b.accuracyPct), 0) / brokers.length).toFixed(1))
      : null;

  const overallReasonableCareScore = Math.max(0, 100 - openFindings.length * 5 - criticalFindings.length * 10);
  const careGrade = overallReasonableCareScore >= 90 ? "Excellent" : overallReasonableCareScore >= 75 ? "Acceptable" : overallReasonableCareScore >= 60 ? "Needs Improvement" : "High Risk";

  return NextResponse.json({
    dashboard: {
      entriesMonitored: filings.length,
      openFindingsCount: openFindings.length,
      criticalFindingsCount: criticalFindings.length,
      avgSupplierRiskScore: avgSupplierRisk,
      avgBrokerAccuracyPct: avgBrokerAccuracy,
      reasonableCareScore: overallReasonableCareScore,
      reasonableCareGrade: careGrade,
      recentAlerts: openFindings.slice(0, 5),
    },
  });
});
