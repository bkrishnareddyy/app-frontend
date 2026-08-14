import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });
const bodySchema = z.object({ reason: z.string().min(1, "Withdrawal reason is required") });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, bodySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { reason } = bodyVal.data;

  const protest = await db.protest.findFirst({ where: { id, accountId: ctx.accountId } });
  if (!protest) {
    return buildErrorResponse(404, "NOT_FOUND", "Protest not found", undefined, requestId);
  }
  if (protest.status === "FILED" || protest.status === "WITHDRAWN") {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      `A protest in status '${protest.status}' cannot be withdrawn. Only pre-FILED protests can be withdrawn.`,
      undefined,
      requestId
    );
  }

  const updated = await db.protest.update({
    where: { id },
    data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawnByUserId: ctx.userId },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PROTEST_WITHDRAWN,
    entity: "Protest",
    entityId: id,
    source: "UI",
    metadata: { reason, previousStatus: protest.status },
  });

  return NextResponse.json({ protest: updated, requestId });
}, { permission: "protest.manage", write: true });
