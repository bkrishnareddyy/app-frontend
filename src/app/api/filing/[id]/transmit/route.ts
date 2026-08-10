import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { FilingService } from "@/modules/filings/filing.service";
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
      metadata: { entryNumber: result.filing.entryNumber, responseId: result.response.id },
    });

    const responsePayload = {
      transmission: {
        status: result.transmissionResult.status,
        entryNumber: result.filing.entryNumber,
        transmittedAt: result.filing.submittedAt,
        providerMetadata: result.transmissionResult.metadata,
        response: result.response,
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
