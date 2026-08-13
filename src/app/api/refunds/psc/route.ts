import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { checkPscEligibility } from "@/lib/refunds/pscEligibility";
import { Decimal } from "@/lib/tariff/decimal";
import { z } from "zod";

const createPscSchema = z.object({
  originalFilingId: z.string().min(1, "originalFilingId is required"),
  refundOpportunityId: z.string().optional(),
  reason: z.string().optional(),
  correctionType: z.string().optional(),
  originalDutyAmount: z.number().nonnegative().optional(),
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

  if (refundOpportunityId) {
    const opp = await db.refundOpportunity.findFirst({
      where: { id: refundOpportunityId, accountId: ctx.accountId },
});
    if (!opp) {
      return buildErrorResponse(404, "NOT_FOUND", "Refund opportunity not found", undefined, requestId);
    }
  }

  // 1. Fetch filing
  const filing = await db.customsFiling.findFirst({
    where: { id: originalFilingId, accountId: ctx.accountId },
  });

  if (!filing) {
    return buildErrorResponse(404, "NOT_FOUND", "Original filing not found", undefined, requestId);
  }

  // 2. Validate PSC eligibility (Task D-2)
  const eligibility = await checkPscEligibility(ctx.accountId, originalFilingId);
  if (!eligibility.eligible) {
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", eligibility.reason, undefined, requestId);
  }

  // 3. Confirm actual duty paid is available (Task D-1)
  const origDutyDec = originalDutyAmount !== undefined 
    ? new Decimal(originalDutyAmount) 
    : (filing.totalDuties ? new Decimal(filing.totalDuties) : null);
  if (origDutyDec === null) {
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", "PSC calculation requires actual duty paid from accepted filing data.", undefined, requestId);
  }

  const corrDutyDec = new Decimal(correctedDutyAmount);
  const refundAmountDec = Decimal.max(0, origDutyDec.minus(corrDutyDec));

  const psc = await db.postSummaryCorrection.create({
    data: {
      accountId: ctx.accountId,
      originalFilingId,
      refundOpportunityId,
      reason: reason ?? "Post-Summary Correction",
      correctionType: correctionType ?? "classification",
      originalDutyAmount: origDutyDec,
      correctedDutyAmount: corrDutyDec,
      refundAmount: refundAmountDec,
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
    action: AuditAction.REFUND_PSC_CREATED,
    entity: "PostSummaryCorrection",
    entityId: psc.id,
    source: "UI",
    metadata: { originalFilingId, refundAmount: refundAmountDec.toNumber() },
  });

  return NextResponse.json({ psc, requestId });

}, { permission: "refunds.manage", write: true });
