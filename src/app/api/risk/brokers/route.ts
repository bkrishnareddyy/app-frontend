import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  // This GET used to write two invented brokers into the tenant's database,
  // with accuracy and override rates that no entry had ever been measured against.
  const brokerMetrics = await db.brokerMetrics.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { accuracyPct: "desc" },
  });

  return NextResponse.json({ brokerMetrics });
});
