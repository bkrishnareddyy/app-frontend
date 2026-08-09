import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  // Seed default supplier risk scores if empty
  const count = await db.supplierRiskScore.count({ where: { accountId: ctx.accountId } });
  if (count === 0) {
    await db.supplierRiskScore.createMany({
      data: [
        {
          accountId: ctx.accountId,
          supplierName: "Foxconn Electronics Ltd",
          score: 12,
          riskLevel: "Low",
          violationHistoryCount: 0,
          missingDocsCount: 1,
          pgaIssuesCount: 0,
          classificationIssuesCount: 0,
        },
        {
          accountId: ctx.accountId,
          supplierName: "Shenzhen Global Components Co",
          score: 68,
          riskLevel: "High",
          violationHistoryCount: 2,
          missingDocsCount: 4,
          pgaIssuesCount: 1,
          classificationIssuesCount: 3,
        },
        {
          accountId: ctx.accountId,
          supplierName: "Tokyo Precision Valve Corp",
          score: 18,
          riskLevel: "Low",
          violationHistoryCount: 0,
          missingDocsCount: 0,
          pgaIssuesCount: 1,
          classificationIssuesCount: 0,
        },
      ],
    });
  }

  const supplierRisks = await db.supplierRiskScore.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { score: "desc" },
  });

  return NextResponse.json({ supplierRisks });
});
