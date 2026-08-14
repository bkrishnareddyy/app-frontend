import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { buildErrorResponse } from "@/lib/api/error";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { transitionDrawbackClaim, DrawbackClaimWorkflowError, DrawbackClaimStatus } from "@/modules/drawback/drawbackClaimWorkflow";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const claim = await db.drawbackClaim.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      matches: {
        include: {
          shipmentLineItem: true,
          exportLineItem: true,
        },
      },
    },
  });

  if (!claim) {
    return NextResponse.json({ error: "Drawback claim not found" }, { status: 404 });
  }

  return NextResponse.json({ drawbackClaim: claim, requestId });
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { status, totalRefundClaimed } = body;

  const existingClaim = await db.drawbackClaim.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!existingClaim) {
    return buildErrorResponse(404, "NOT_FOUND", "Drawback claim not found", undefined, requestId);
  }

  let updatedClaim = existingClaim;

  if (status) {
    try {
      updatedClaim = await transitionDrawbackClaim({
        claimId: id,
        targetStatus: status as DrawbackClaimStatus,
        accountId: ctx.accountId,
        userId: ctx.userId,
        userPermissions: ctx.permissions || [],
        isBroker: ctx.roles?.includes("broker") || ctx.roles?.includes("admin"),
      });
    } catch (err: any) {
      if (err instanceof DrawbackClaimWorkflowError) {
        return buildErrorResponse(err.statusCode, err.statusCode === 403 ? "FORBIDDEN" : "INVALID_TRANSITION", err.message, undefined, requestId);
      }
      return buildErrorResponse(400, "BAD_REQUEST", err.message || "Failed to update drawback claim status", undefined, requestId);
    }
  }

  if (totalRefundClaimed !== undefined) {
    updatedClaim = await db.drawbackClaim.update({
      where: { id },
      data: { totalRefundClaimed },
      include: { matches: true },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "drawback.claim_update",
      entity: "DrawbackClaim",
      entityId: id,
      source: "UI",
      metadata: { totalRefundClaimed },
    });
  }

  return NextResponse.json({ drawbackClaim: updatedClaim, requestId });

}, { permission: "drawback.claim", write: true });
