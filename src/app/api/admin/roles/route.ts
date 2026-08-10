import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { getRolesPermissionsData } from "@/lib/admin/rolesData";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const data = await getRolesPermissionsData(ctx);
  return NextResponse.json({ accountName: ctx.accountName, ...data, requestId });
}, { permission: "users.manage" });
