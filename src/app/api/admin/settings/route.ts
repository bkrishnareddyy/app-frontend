import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { getSettingsAuditData } from "@/lib/admin/auditData";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const data = await getSettingsAuditData(ctx);
  return NextResponse.json({ accountName: ctx.accountName, ...data, requestId });
});
