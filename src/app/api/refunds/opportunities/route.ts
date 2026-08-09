import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const opportunities = await db.refundOpportunity.findMany({
    where: { accountId: ctx.accountId },
    include: {
      filing: {
        include: { shipment: true },
      },
    },
    orderBy: { identifiedAt: "desc" },
  });

  return NextResponse.json({ opportunities });
});
