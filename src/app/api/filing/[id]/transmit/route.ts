import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId , errorMessage } from "@/lib/api/error";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { FilingService } from "@/modules/filings/filing.service";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest("filings.submit");
  if (errorResponse) return errorResponse;

  const { id } = await context.params;

  const { idempotencyKey, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx!.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  try {
    const result = await FilingService.transmitFiling(ctx!.accountId, ctx!.userId, id);

    await createAuditLog({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
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
      await persistIdempotency(ctx!.accountId, idempotencyKey, "", 200, responsePayload);
    }

    return NextResponse.json(responsePayload);
  } catch (error: unknown) {
    if (errorMessage(error) === "NOT_FOUND") {
      return buildErrorResponse(404, "NOT_FOUND", "Filing case not found", undefined, requestId);
    }
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to transmit filing", undefined, requestId);
  }
}
