import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";

const paramsSchema = z.object({ id: z.string().min(1) });

const updateChatSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  messages: z.array(z.unknown()).optional(),
  history: z.array(z.unknown()).optional(),
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  const body = await parseAndValidateBody(req, updateChatSchema, requestId);
  if ("response" in body) return body.response;

  const existing = await db.assistantChatSession.findFirst({
    where: { id: paramsVal.data.id, accountId: ctx.accountId, userId: ctx.userId },
});
  if (!existing) {
    return NextResponse.json({ error: "Chat session not found", requestId });
  }

  const session = await db.assistantChatSession.update({
    where: { id: existing.id },
    data: {
      ...(body.data.title !== undefined && { title: body.data.title }),
      ...(body.data.messages !== undefined && { messages: body.data.messages as Prisma.InputJsonValue }),
      ...(body.data.history !== undefined && { history: body.data.history as Prisma.InputJsonValue }),
    },
  });

  return NextResponse.json({ session, requestId });

}, { permission: "ai.use", write: true });

export const DELETE = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  const existing = await db.assistantChatSession.findFirst({
    where: { id: paramsVal.data.id, accountId: ctx.accountId, userId: ctx.userId },
});
  if (!existing) {
    return NextResponse.json({ error: "Chat session not found", requestId });
  }

  await db.assistantChatSession.delete({ where: { id: existing.id } });

  return NextResponse.json({ success: true, requestId });

}, { permission: "ai.use", write: true });
