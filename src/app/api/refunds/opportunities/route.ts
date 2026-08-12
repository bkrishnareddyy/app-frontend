import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const opportunities = await db.refundOpportunity.findMany({
    where: { accountId: ctx.accountId },
    include: {
      filing: {
        // filingDeadline is in the Prisma schema but not yet applied to the
        // live DB (migration pending) -- must stay omitted or this 500s.
        include: { shipment: { omit: { filingDeadline: true } } },
      },
    },
    orderBy: { identifiedAt: "desc" },
  });

  return NextResponse.json({ opportunities });
});
