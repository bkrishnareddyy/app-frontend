import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { db } from "@/lib/db";
import { applyTransition, FilingTransitionError } from "@/modules/filings/filingStateMachine";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * Broker sign-off: ReadyForBrokerReview -> BrokerApproved. This is the one
 * transition in filingStateMachine.ts that had no caller anywhere in the
 * codebase -- without it, a filing could never legally reach a status from
 * which "transmit.send" is allowed.
 */
export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const { idempotencyKey, requestHash, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  const filing = await db.customsFiling.findFirst({ where: { id, accountId: ctx.accountId } });
  if (!filing) {
    return buildErrorResponse(404, "NOT_FOUND", "Filing case not found", undefined, requestId);
  }

  const rawBody = await req.clone().json().catch(() => ({}));
  const auditSource = (req.headers?.get?.("x-qubere-source") === "CHAT" || rawBody?.source === "CHAT") ? "CHAT" : "UI";

  // Maker/checker: whoever prepared this filing cannot also be the one who
  // signs off on it. A filing created before this field existed has
  // preparedByUserId === null, which never matches a real userId, so it
  // falls through to allow the approval rather than blocking on missing data.
  if (filing.preparedByUserId && filing.preparedByUserId === ctx.userId) {
    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: AuditAction.FILING_SEGREGATION_VIOLATION,
      entity: "CustomsFiling",
      entityId: id,
      source: auditSource,
      metadata: { attemptedAction: "approve", entryNumber: filing.entryNumber },
    });
    return buildErrorResponse(
      403,
      "SEGREGATION_OF_DUTIES_VIOLATION",
      "The user who prepared this filing cannot also approve it. A different reviewer must sign off.",
      undefined,
      requestId
    );
  }

  try {
    const nextStatus = applyTransition(filing.filingStatus, "broker.approve");
    const updated = await db.customsFiling.update({
      where: { id },
      data: { filingStatus: nextStatus, approvedByUserId: ctx.userId },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: AuditAction.FILING_APPROVED,
      entity: "CustomsFiling",
      entityId: id,
      source: auditSource,
      metadata: { entryNumber: updated.entryNumber, previousStatus: filing.filingStatus, newStatus: nextStatus },
    });

    const responsePayload = {
      approval: { status: updated.filingStatus, entryNumber: updated.entryNumber },
      requestId,
    };

    if (idempotencyKey) {
      await persistIdempotency(ctx.accountId, idempotencyKey, requestHash ?? "", 200, responsePayload);
    }

    return NextResponse.json(responsePayload);
  } catch (error: unknown) {
    if (error instanceof FilingTransitionError) {
      return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", error.message, undefined, requestId);
    }
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to approve filing", undefined, requestId);
  }

}, { permission: "filings.submit", write: true });
