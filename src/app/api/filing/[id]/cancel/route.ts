import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { FilingService } from "@/modules/filings/filing.service";
import { simulateAndApplyResponse } from "@/lib/canonicalMessaging/devStub";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const { idempotencyKey, requestHash, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  try {
    const result = await FilingService.cancelFiling(ctx.accountId, ctx.userId, id);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "filing.cancel",
      entity: "CustomsFiling",
      entityId: id,
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
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to cancel filing", undefined, requestId);
  }
}, { permission: "filings.submit", write: true });
