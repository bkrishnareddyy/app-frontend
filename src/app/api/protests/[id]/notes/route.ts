import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });
const noteSchema = z.object({
  body: z.string().min(1, "Note body is required"),
  isInternal: z.boolean().default(true),
});

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, noteSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { body, isInternal } = bodyVal.data;

  const protest = await db.protest.findFirst({ where: { id, accountId: ctx.accountId } });
  if (!protest) {
    return buildErrorResponse(404, "NOT_FOUND", "Protest not found", undefined, requestId);
  }

  const note = await db.protestNote.create({
    data: { protestId: id, authorId: ctx.userId, body, isInternal },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PROTEST_NOTE_ADDED,
    entity: "Protest",
    entityId: id,
    source: "UI",
    metadata: { isInternal },
  });

  return NextResponse.json({ note, requestId }, { status: 201 });
}, { permission: "protest.create", write: true });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const protest = await db.protest.findFirst({ where: { id, accountId: ctx.accountId } });
  if (!protest) {
    return buildErrorResponse(404, "NOT_FOUND", "Protest not found", undefined, requestId);
  }

  const notes = await db.protestNote.findMany({
    where: { protestId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ notes, requestId });
}, { permission: "protest.read" });
