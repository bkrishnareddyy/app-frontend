import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const documents = await db.shipmentDocument.findMany({
    where: { accountId: ctx.accountId, shipmentId: null },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ documents });
});
