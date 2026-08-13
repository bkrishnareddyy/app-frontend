import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

const createPscSchema = z.object({
  originalFilingId: z.string().min(1, "originalFilingId is required"),
  refundOpportunityId: z.string().optional(),
  reason: z.string().optional(),
  correctionType: z.string().optional(),
  originalDutyAmount: z.number().nonnegative().optional(),
  // correctedDutyAmount is required: callers must supply the actual corrected
  // figure. No fallback heuristic — there is no statutory basis for one.
  correctedDutyAmount: z.number().nonnegative({ message: "correctedDutyAmount is required and must be a non-negative number" }),
});

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const pscs = await db.postSummaryCorrection.findMany({
    where: { accountId: ctx.accountId },
    include: {
      originalFiling: {
        include: { shipment: true },
      },
      refundOpportunity: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ pscs, requestId });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createPscSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  const { originalFilingId, refundOpportunityId, reason, correctionType, originalDutyAmount, correctedDutyAmount } = bodyVal.data;

  const filing = await db.customsFiling.findFirst({
    where: { id: originalFilingId, accountId: ctx.accountId },
  });

  if (!filing) {
    return buildErrorResponse(404, "NOT_FOUND", "Original filing not found", undefined, requestId);
  }

  if (refundOpportunityId) {
    const opportunity = await db.refundOpportunity.findFirst({
      where: { id: refundOpportunityId, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!opportunity) {
      return buildErrorResponse(404, "NOT_FOUND", "Refund opportunity not found", undefined, requestId);
    }
  }

  const origDuty = originalDutyAmount !== undefined ? originalDutyAmount : Number(filing.totalDuties);
  const corrDuty = correctedDutyAmount;
  const refundAmount = Math.max(0, origDuty - corrDuty);

  const psc = await db.postSummaryCorrection.create({
    data: {
      accountId: ctx.accountId,
      originalFilingId,
      refundOpportunityId,
      reason: reason ?? "Post-Summary Correction",
      correctionType: correctionType ?? "classification",
      originalDutyAmount: origDuty,
      correctedDutyAmount: corrDuty,
      refundAmount,
      status: "Draft",
      createdByUserId: ctx.userId,
    },
    include: {
      originalFiling: true,
      refundOpportunity: true,
    },
  });

  if (refundOpportunityId) {
    await db.refundOpportunity.update({
      where: { id: refundOpportunityId },
      data: { status: "ConvertedToPSC" },
    });
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "psc.create",
    entity: "PostSummaryCorrection",
    entityId: psc.id,
    metadata: { originalFilingId, refundAmount },
  });

  return NextResponse.json({ psc, requestId }, { status: 201 });
}, { permission: "refunds.manage", write: true });
