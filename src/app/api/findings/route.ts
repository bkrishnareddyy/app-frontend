import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const severity = searchParams.get("severity");

  const where: import("@prisma/client").Prisma.ComplianceFindingWhereInput = { accountId: ctx.accountId };

  if (status && status !== "all") {
    where.status = { equals: status, mode: "insensitive" };
  }
  if (severity) {
    where.severity = { equals: severity, mode: "insensitive" };
  }

  // Seed default compliance findings if empty
  const count = await db.complianceFinding.count({ where: { accountId: ctx.accountId } });
  if (count === 0) {
    const filing = await db.customsFiling.findFirst({ where: { accountId: ctx.accountId } });
    if (filing) {
      await db.complianceFinding.createMany({
        data: [
          {
            accountId: ctx.accountId,
            filingId: filing.id,
            rule: "Valuation Variance Analysis",
            severity: "High",
            description: "Declared unit price for part PN-9901 is 24% lower than 6-month historical import average.",
            recommendation: "Request vendor transfer pricing documentation or proof of non-related party transaction.",
            status: "Open",
            confidence: 94,
            assignedToUserId: ctx.userId,
          },
          {
            accountId: ctx.accountId,
            filingId: filing.id,
            rule: "Potential Undeclared Assist Detection",
            severity: "Warning",
            description: "Commercial Invoice references customer-supplied tooling die #T-405 without declared assist value.",
            recommendation: "Verify tooling assist cost allocation under 19 CFR 152.103 and add to entered value.",
            status: "Investigating",
            confidence: 88,
            assignedToUserId: ctx.userId,
          },
        ],
      });
    }
  }

  const findings = await db.complianceFinding.findMany({
    where,
    include: {
      filing: {
        include: { shipment: true },
      },
      assignedToUser: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ findings });
});
