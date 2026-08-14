import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });
const bodySchema = z.object({
  justification: z.string().min(20, "FRP justification must be at least 20 characters"),
});

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, bodySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { justification } = bodyVal.data;

  const protest = await db.protest.findFirst({ where: { id, accountId: ctx.accountId } });
  if (!protest) {
    return buildErrorResponse(404, "NOT_FOUND", "Protest not found", undefined, requestId);
  }
  if (!["DRAFT", "READY_FOR_FILING", "FILED"].includes(protest.status)) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      "Further Review can only be requested for DRAFT, READY_FOR_FILING, or FILED protests.",
      undefined,
      requestId
    );
  }

  const updated = await db.protest.update({
    where: { id },
    data: {
      furtherReviewRequested: true,
      frpJustification: justification,
      status: protest.status === "FILED" ? "FURTHER_REVIEW_REQUESTED" : protest.status,
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PROTEST_FRP_REQUESTED,
    entity: "Protest",
    entityId: id,
    source: "UI",
    metadata: { justification },
  });

  return NextResponse.json({ protest: updated, requestId });
}, { permission: "protest.manage", write: true });
