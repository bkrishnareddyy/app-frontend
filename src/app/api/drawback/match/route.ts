import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { DrawbackService } from "@/modules/drawback/drawback.service";
import { z } from "zod";

const matchSchema = z.object({
  matchMethod: z.enum(["FIFO", "LIFO", "DIRECT_IDENTIFICATION"]).default("FIFO"),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const { idempotencyKey, requestHash, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  const bodyVal = await parseAndValidateBody(req, matchSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const result = await DrawbackService.matchInventory(ctx.accountId, { matchStrategy: bodyVal.data.matchMethod });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "drawback.match_run",
      entity: "DrawbackMatchingRun",
      entityId: ctx.accountId,
      metadata: { proposedMatchesCount: result.proposedMatchesCount, strategy: bodyVal.data.matchMethod },
    });

    const responsePayload = { ...result, requestId };

    if (idempotencyKey) {
      await persistIdempotency(ctx.accountId, idempotencyKey, requestHash ?? "", 200, responsePayload);
    }

    return NextResponse.json(responsePayload);
  } catch (error: unknown) {
    return buildErrorResponse(500, "INTERNAL_ERROR", errorMessage(error) || "Failed to run drawback matching", undefined, requestId);
  }
}, { write: true });
