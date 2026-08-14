import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse, errorMessage } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { checkIdempotency, persistIdempotency } from "@/lib/api/idempotency";
import { createAuditLog } from "@/lib/audit";
import { DrawbackService } from "@/modules/drawback/drawback.service";
import { parsePagination } from "@/lib/api/pagination";
import { db } from "@/lib/db";
import { z } from "zod";

const createClaimSchema = z.object({
  claimType: z.enum(["manufacturing", "unused_merchandise"]).default("unused_merchandise"),
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

export const GET = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const { searchParams } = new URL(req.url);
  const { limit, cursor } = parsePagination(searchParams);

  const where: import("@prisma/client").Prisma.DrawbackClaimWhereInput = { accountId: ctx.accountId };
  if (cursor) {
    where.id = { lt: cursor };
  }

  const [claims, total] = await Promise.all([
    db.drawbackClaim.findMany({
      where,
      include: {
        matches: {
          include: {
            shipmentLineItem: true,
            exportLineItem: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.drawbackClaim.count({ where: { accountId: ctx.accountId } }),
  ]);

  const nextCursor = claims.length === limit ? (claims[claims.length - 1]?.id ?? null) : null;

  return NextResponse.json({ drawbackClaims: claims, pagination: { nextCursor, hasMore: nextCursor !== null, total }, requestId });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const { idempotencyKey, requestHash, cachedResponse, errorResponse: idempError } = await checkIdempotency(req, ctx.accountId, requestId);
  if (cachedResponse) return cachedResponse;
  if (idempError) return idempError;

  const bodyVal = await parseAndValidateBody(req, createClaimSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  try {
    const result = await DrawbackService.createClaim(ctx.accountId, ctx.userId, bodyVal.data);

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "drawback.claim_create",
      entity: "DrawbackClaim",
      entityId: result.claim.id,
      source: "UI",
      metadata: { claimType: result.claim.claimType, totalRefund: result.claim.totalRefundClaimed },
});

    const responsePayload = { drawbackClaim: result.claim, internalRef: result.internalClaimRef, requestId };

    if (idempotencyKey) {
      await persistIdempotency(ctx.accountId, idempotencyKey, requestHash ?? "", 201, responsePayload);
    }

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (error: unknown) {
    return buildErrorResponse(400, "BUSINESS_RULE_FAILURE", errorMessage(error) || "Failed to create drawback claim", undefined, requestId);
  }

}, { permission: "drawback.claim", write: true });
