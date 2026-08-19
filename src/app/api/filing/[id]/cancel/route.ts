import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { FilingService } from "@/modules/filings/filing.service";
import { simulateAndApplyResponse } from "@/lib/canonicalMessaging/devStub";
import { MissingActionFieldError } from "@/lib/canonicalMessaging/actionDataRequirements";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });
// Whatever the operator supplied for this filing's "prompt"-sourced action
// fields (resolved via FilingActionDataRequirement) -- shape varies by
// country/procedure, so this is intentionally not a fixed schema.
const bodySchema = z.object({ promptedValues: z.record(z.string(), z.unknown()).optional() });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  // checkIdempotency reads the body via req.clone() -- must run before this
  // route's own req.json() call, since a Request's body stream can only be
  // consumed once and a clone taken after that point can't be read.
  const { idempotencyKey, requestHash, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  const rawBody = await req.json().catch(() => ({}));
  const auditSource = (req.headers?.get?.("x-qubere-source") === "CHAT" || rawBody?.source === "CHAT") ? "CHAT" : "UI";
  const body = bodySchema.safeParse(rawBody);
  const promptedValues = body.success ? (body.data.promptedValues ?? {}) : {};

  try {
    const result = await FilingService.cancelFiling(ctx.accountId, ctx.userId, id, promptedValues);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: AuditAction.FILING_CANCELLED,
      entity: "CustomsFiling",
      entityId: id,
      source: auditSource,
      metadata: { entryNumber: result.filing.entryNumber, messageId: result.messageId },
    });

    let mockResponseApplied = false;
    try {
      mockResponseApplied = await simulateAndApplyResponse(result.messageId);
    } catch (err) {
      console.warn(`[cancel] dev-stub response simulation failed for filing ${id}:`, err);
    }

    // filingStatus is intentionally unchanged by cancelFiling() -- see the
    // comment on FilingService.cancelFiling for why. The cancellation request
    // has been sent; status will only move once a legal transition + response
    // mapping exists for it. The mock CANCELLED response is still recorded on
    // the Response tab (see devStub.ts) even though it can't move status.
    const responsePayload = {
      cancellation: {
        status: result.filing.filingStatus,
        entryNumber: result.filing.entryNumber,
        messageId: result.messageId,
        mockResponseApplied,
      },
      requestId,
    };

    if (idempotencyKey) {
      await persistIdempotency(ctx.accountId, idempotencyKey, requestHash ?? "", 200, responsePayload);
    }

    return NextResponse.json(responsePayload);
  } catch (error: unknown) {
    if (errorMessage(error) === "NOT_FOUND") {
      return buildErrorResponse(404, "NOT_FOUND", "Filing case not found", undefined, requestId);
    }
    if (error instanceof MissingActionFieldError) {
      return buildErrorResponse(400, "MISSING_ACTION_FIELD", error.message, { fieldKey: error.fieldKey }, requestId);
    }
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to cancel filing", undefined, requestId);
  }

}, { permission: "filings.submit", write: true });
