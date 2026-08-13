import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

const paramsSchema = z.object({ id: z.string().min(1) });

/** Revokes (never hard-deletes) an inbound sender route. */
export const DELETE = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const existing = await db.inboundSenderRoute.findFirst({ where: { id, accountId: ctx.accountId } });
  if (!existing) {
    return NextResponse.json({ error: "Sender route not found", requestId });
  }

  const route = await db.inboundSenderRoute.update({
    where: { id },
    data: { status: "REVOKED" },
});

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "inbound_sender_route.revoked",
    entity: "InboundSenderRoute",
    entityId: id,
    source: "UI",
    metadata: { normalizedSenderEmail: existing.normalizedSenderEmail },
    requestId,
  });

  return NextResponse.json({ route, requestId });

}, { permission: "settings.manage", write: true });
