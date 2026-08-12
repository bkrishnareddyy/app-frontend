import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);
  const result = searchParams.get("result");

  const where: import("@prisma/client").Prisma.ComplianceAuditRecordWhereInput = { accountId: ctx.accountId };
  if (result) {
    where.overallResult = { equals: result, mode: "insensitive" };
  }

  const auditRecords = await db.complianceAuditRecord.findMany({
    where,
    include: {
      filing: {
        // filingDeadline is in the Prisma schema but not yet applied to the
        // live DB (migration pending) -- must stay omitted or this 500s.
        include: { shipment: { omit: { filingDeadline: true } } },
      },
    },
    orderBy: { runAt: "desc" },
  });

  return NextResponse.json({ auditRecords });
});
