import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId } from "@/lib/api/error";
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

export async function POST(req: Request) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  const { idempotencyKey, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx!.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  const bodyVal = await parseAndValidateBody(req, classifySchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const result = await ClassificationService.classifyProduct(ctx!.accountId, ctx!.userId, bodyVal.data);

    await createAuditLog({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
      action: "classification.classify",
      entity: "ClassificationProposal",
      entityId: result.proposedClassification?.htsCode || "UNKNOWN",
      metadata: { description: bodyVal.data.productDescription, status: result.status },
    });

    const responsePayload = { ...result, requestId };

    if (idempotencyKey) {
      await persistIdempotency(ctx!.accountId, idempotencyKey, "", 200, responsePayload);
    }

    return NextResponse.json(responsePayload);
  } catch (error: any) {
    return buildErrorResponse(500, "INTERNAL_ERROR", error?.message || "Failed to classify product", undefined, requestId);
  }
}
