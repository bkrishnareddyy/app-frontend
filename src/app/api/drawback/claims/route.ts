import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/api/auth-guards";
import { buildErrorResponse, generateRequestId } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { DrawbackService } from "@/modules/drawback/drawback.service";
import { db } from "@/lib/db";
import { z } from "zod";

const createClaimSchema = z.object({
  claimType: z.enum(["manufacturing", "unused_merchandise", "rejected_merchandise"]).default("unused_merchandise"),
  matches: z.array(
    z.object({
      shipmentLineItemId: z.string(),
      exportLineItemId: z.string(),
      matchedQuantity: z.number().positive(),
      matchMethod: z.string().optional(),
      dutyAttributed: z.number().nonnegative(),
    })
  ).min(1, "Claim requires at least one accepted inventory match allocation"),
});

export async function GET(req: Request) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest();
  if (errorResponse) return errorResponse;

  try {
    const claims = await db.drawbackClaim.findMany({
      where: { accountId: ctx!.accountId },
      include: {
        matches: {
          include: {
            shipmentLineItem: true,
            exportLineItem: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ drawbackClaims: claims, requestId });
  } catch (error: any) {
    return buildErrorResponse(500, "INTERNAL_ERROR", error?.message || "Failed to list drawback claims", undefined, requestId);
  }
}

export async function POST(req: Request) {
  const requestId = generateRequestId();
  const { ctx, errorResponse } = await authorizeRequest("drawback.claim");
  if (errorResponse) return errorResponse;

  const { idempotencyKey, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx!.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  const bodyVal = await parseAndValidateBody(req, createClaimSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const result = await DrawbackService.createClaim(ctx!.accountId, ctx!.userId, bodyVal.data);

    await createAuditLog({
      accountId: ctx!.accountId,
      userId: ctx!.userId,
      action: "drawback.claim_create",
      entity: "DrawbackClaim",
      entityId: result.claim.id,
      metadata: { claimType: result.claim.claimType, totalRefund: result.claim.totalRefundClaimed },
    });

    const responsePayload = { drawbackClaim: result.claim, internalRef: result.internalClaimRef, requestId };

    if (idempotencyKey) {
      await persistIdempotency(ctx!.accountId, idempotencyKey, "", 201, responsePayload);
    }

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (error: any) {
    return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", error?.message || "Failed to create drawback claim", undefined, requestId);
  }
}
