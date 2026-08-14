import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });
const bodySchema = z.object({ reason: z.string().min(1, "Withdrawal reason is required") });

/**
 * POST /api/refunds/psc/[id]/withdraw
 * Withdraws a PSC (any status before ACE_ACCEPTED).
 * Requires psc.manage permission.
 */
export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const bodyVal = await parseAndValidateBody(req, bodySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;
  const { reason } = bodyVal.data;

  const psc = await db.postSummaryCorrection.findFirst({
    where: { id, accountId: ctx.accountId },
  });
  if (!psc) {
    return buildErrorResponse(404, "NOT_FOUND", "PSC not found", undefined, requestId);
  }

  const nonWithdrawable = ["ACE_ACCEPTED", "WITHDRAWN"];
  if (nonWithdrawable.includes(psc.status)) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      `A PSC in status '${psc.status}' cannot be withdrawn.`,
      undefined,
      requestId
    );
  }

  const updated = await db.postSummaryCorrection.update({
    where: { id },
    data: {
      status: "WITHDRAWN",
      withdrawnAt: new Date(),
      withdrawnByUserId: ctx.userId,
      notes: psc.notes
        ? `${psc.notes}\n\nWithdrawal reason: ${reason}`
        : `Withdrawal reason: ${reason}`,
    },
    include: { originalFiling: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PSC_WITHDRAWN,
    entity: "PostSummaryCorrection",
    entityId: id,
    source: "UI",
    metadata: { reason, previousStatus: psc.status },
  });

  return NextResponse.json({ psc: updated, requestId });
}, { permission: "psc.manage", write: true });
