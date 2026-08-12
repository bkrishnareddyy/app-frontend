import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const result = await db.notification.updateMany({
    where: { id, userId: ctx.userId, accountId: ctx.accountId },
    data: { read: true },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Notification not found", requestId }, { status: 404 });
  }

  return NextResponse.json({ requestId });
});
