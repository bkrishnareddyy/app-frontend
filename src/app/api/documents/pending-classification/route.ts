import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

/**
 * Returns the number of documents awaiting human classification review.
 * Polled by the Sidebar to drive the Documents nav-item badge (B-3).
 */
export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const count = await db.shipmentDocument.count({
    where: {
      accountId: ctx.accountId,
      status: "NEEDS_CLASSIFICATION",
    },
  });

  return NextResponse.json({ count, requestId });
});
