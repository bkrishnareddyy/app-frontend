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

  // This GET used to attach two invented findings to a real customs filing --
  // a 24% valuation variance and an undeclared tooling assist, with confidences
  // of 94 and 88 -- and assign them to the caller. They were allegations against
  // an entry that no rule had ever evaluated.
  const findings = await db.complianceFinding.findMany({
    where,
    include: {
      filing: {
        // filingDeadline is in the Prisma schema but not yet applied to the
        // live DB (migration pending) -- must stay omitted or this 500s.
        include: { shipment: { omit: { filingDeadline: true } } },
      },
      assignedToUser: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ findings });
});
