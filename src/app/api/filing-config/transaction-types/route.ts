import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { db } from "@/lib/db";

/**
 * GET /api/filing-config/transaction-types
 * Returns list of transaction type codes for populating procedureCode dropdown
 */
export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  if (!ctx.isPlatformAdmin) {
    return buildErrorResponse(403, "FORBIDDEN", "Filing configuration is available to Platform Admins only.", undefined, requestId);
  }

  const transactionTypes = await db.filingTransactionType.findMany({
    where: { isActive: true },
    select: { code: true },
    orderBy: { code: "asc" },
  });

  return NextResponse.json({ 
    codes: transactionTypes.map(tt => tt.code),
    requestId 
  });
});
