import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";

const MAX_SESSIONS_PER_USER = 20;

const createChatSchema = z.object({
  title: z.string().min(1).max(200),
  messages: z.array(z.unknown()).default([]),
  history: z.array(z.unknown()).default([]),
});

export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor")?.trim() || undefined;
  const limitParam = searchParams.get("limit") || searchParams.get("pageSize");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 50) : 10;

  const sessions = await db.assistantChatSession.findMany({
    where: { accountId: ctx.accountId, userId: ctx.userId },
    orderBy: { updatedAt: "desc" },
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  let nextCursor: string | null = null;
  if (sessions.length > limit) {
    const nextItem = sessions.pop();
    nextCursor = nextItem?.id ?? null;
  }

  return NextResponse.json({ sessions, nextCursor, limit });
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
