import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { ClassificationService } from "@/modules/classification/classification.service";
import { z } from "zod";

const classifySchema = z.object({
  productDescription: z.string().min(2, "productDescription is required"),
  materialComposition: z.string().optional(),
  functionUsage: z.string().optional(),
  principalUse: z.string().optional(),
  partNumber: z.string().optional(),
  brandModel: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  shipmentId: z.string().optional(),
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const { idempotencyKey, requestHash, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  const bodyVal = await parseAndValidateBody(req, classifySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  // Feature Flag / Kill Switch: Prevent legacy mock classification behavior
  if (process.env.ENABLE_LEGACY_CLASSIFICATION_MOCK !== "true") {
    return buildErrorResponse(
      503,
      "CLASSIFICATION_ENGINE_MIGRATION",
      "The legacy synchronous classification endpoint is disabled while the production AI Classification Engine & HTS Master (asynchronous case pipeline) is under migration.",
      undefined,
      requestId
    );
  }

  try {
    const result = await ClassificationService.classifyProduct(ctx.accountId, ctx.userId, bodyVal.data);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "classification.classify",
      entity: "ClassificationProposal",
      entityId: result.proposedClassification?.htsCode || "UNKNOWN",
      metadata: { description: bodyVal.data.productDescription, status: result.status },
    });

    const responsePayload = { ...result, requestId };

    if (idempotencyKey) {
      await persistIdempotency(ctx.accountId, idempotencyKey, requestHash ?? "", 200, responsePayload);
    }

    return NextResponse.json(responsePayload);
  } catch (error: unknown) {
    return buildErrorResponse(500, "INTERNAL_ERROR", errorMessage(error) || "Failed to classify product", undefined, requestId);
  }
}, { permission: "classification.create", write: true });
