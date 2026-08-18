import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { recordUsageEvent } from "@/lib/billing/telemetry";
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

  // The production classification path runs through PipelineOrchestrator, which
  // now emits HTS_CLASSIFICATION_COMPLETED with idempotencyKey billing:<runId>:<agentName>.
  // This route uses a different key scheme so the two paths cannot double-count.
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
    const startedAt = Date.now();
    const result = await ClassificationService.classifyProduct(ctx.accountId, ctx.userId, bodyVal.data);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "classification.classify",
      entity: "ClassificationProposal",
      entityId: result.proposedClassification?.htsCode || "UNKNOWN",
      source: "UI",
      metadata: { description: bodyVal.data.productDescription, status: result.status },
    });

    if (bodyVal.data.shipmentId) {
      try {
        const shipment = await db.shipment.findFirst({
          where: { id: bodyVal.data.shipmentId, accountId: ctx.accountId },
          select: { id: true, clientId: true, importerOfRecordId: true },
        });

        if (shipment) {
          await recordUsageEvent({
            accountId: ctx.accountId,
            eventCode: "HTS_CLASSIFICATION_COMPLETED",
            clientId: shipment.clientId ?? undefined,
            importerId: shipment.importerOfRecordId ?? undefined,
            shipmentId: shipment.id,
            userId: ctx.userId,
            quantity: 1,
            unit: "classification",
            sourceFunction: "ClassificationService.classifyProduct",
            sourceApi: "/api/classification/classify",
            sourceAgent: "HTS Classification Agent",
            success: true,
            automated: true,
            processingDuration: Date.now() - startedAt,
            idempotencyKey: `billing:classification:${idempotencyKey ?? requestId}`,
            metadata: { htsCode: result.proposedClassification?.htsCode, status: result.status },
          });
        }
      } catch (billingError) {
        // Billing observability must not turn a successful operational result into
        // a failed classification response. Revenue-leakage monitoring can surface
        // telemetry failures separately.
        console.error("Failed to record classification billing usage", billingError);
      }
    }

    const responsePayload = { ...result, requestId };
    if (idempotencyKey) {
      await persistIdempotency(ctx.accountId, idempotencyKey, requestHash ?? "", 200, responsePayload);
    }
    return NextResponse.json(responsePayload);
  } catch (error: unknown) {
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Classification failed", undefined, requestId);
  }
}, { permission: "classification.create", write: true });
