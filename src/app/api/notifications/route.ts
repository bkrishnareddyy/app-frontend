import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { accountId: ctx.accountId, userId: ctx.userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.notification.count({
      where: { accountId: ctx.accountId, userId: ctx.userId, read: false },
    }),
  ]);

  return NextResponse.json({ notifications, unreadCount, requestId });
});
