import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const POST = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  await db.notification.updateMany({
    where: { accountId: ctx.accountId, userId: ctx.userId, read: false },
    data: { read: true },
  });
  return NextResponse.json({ requestId });
});
