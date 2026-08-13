import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";

// Only the 10 most-recently-updated sessions per user/account are kept.
const MAX_SESSIONS_PER_USER = 10;

const createChatSchema = z.object({
  title: z.string().min(1).max(200),
  messages: z.array(z.unknown()).default([]),
  history: z.array(z.unknown()).default([]),
});

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
  const sessions = await db.assistantChatSession.findMany({
    where: { accountId: ctx.accountId, userId: ctx.userId },
    orderBy: { updatedAt: "desc" },
    take: MAX_SESSIONS_PER_USER,
  });

  return NextResponse.json({ sessions });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const body = await parseAndValidateBody(req, createChatSchema, requestId);
  if ("response" in body) return body.response;

  const created = await db.assistantChatSession.create({
    data: {
      accountId: ctx.accountId,
      userId: ctx.userId,
      title: body.data.title,
      messages: body.data.messages as Prisma.InputJsonValue,
      history: body.data.history as Prisma.InputJsonValue,
    },
});

  // Prune anything beyond the most-recent MAX_SESSIONS_PER_USER for this user/account.
  const stale = await db.assistantChatSession.findMany({
    where: { accountId: ctx.accountId, userId: ctx.userId },
    orderBy: { updatedAt: "desc" },
    skip: MAX_SESSIONS_PER_USER,
    select: { id: true },
  });
  if (stale.length > 0) {
    await db.assistantChatSession.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }

  return NextResponse.json({ session: created });

}, { permission: "ai.use", write: true });
