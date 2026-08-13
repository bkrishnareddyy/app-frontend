import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
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
    const result = await FilingService.transmitFiling(ctx.accountId, ctx.userId, id);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "filing.transmit",
      entity: "CustomsFiling",
      entityId: id,
      metadata: { entryNumber: result.filing.entryNumber, messageId: result.messageId },
    });

    // No real third party exists yet, so there is no other process that will
    // ever answer the outbound message we just published. In production,
    // with a real integration wired up, this same message would sit PENDING
    // until they respond -- CUSTOMS_FILING_MOCK_RESPONSES=false restores that
    // behaviour. A simulation failure must never fail the transmit itself:
    // the real outbound message is already durably published at this point.
    let mockResponseApplied = false;
    try {
      mockResponseApplied = await simulateAndApplyResponse(result.messageId);
    } catch (err) {
      console.warn(`[transmit] dev-stub response simulation failed for filing ${id}:`, err);
    }

    const latestFiling = mockResponseApplied
      ? await db.customsFiling.findUnique({ where: { id } })
      : null;

    const responsePayload = {
      transmission: {
        status: latestFiling?.filingStatus ?? result.filing.filingStatus,
        entryNumber: result.filing.entryNumber,
        transmittedAt: result.filing.submittedAt,
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
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to transmit filing", undefined, requestId);
  }
}, { permission: "filings.submit", write: true });
