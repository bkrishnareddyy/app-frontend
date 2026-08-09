import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  // This GET used to write three invented suppliers into the tenant's database,
  // including a named company scored 68/High with a fabricated violation history.
  const supplierRisks = await db.supplierRiskScore.findMany({
    where: { accountId: ctx.accountId },
    orderBy: { score: "desc" },
  });

  return NextResponse.json({ supplierRisks });
});
