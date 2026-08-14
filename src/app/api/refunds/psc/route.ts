import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { parseAndValidateBody } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { checkPscEligibility } from "@/lib/refunds/pscEligibility";
import { Decimal, roundToCents } from "@/lib/tariff/decimal";
import { calculateDutyStack, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";
import { z } from "zod";

export const PscCorrectionTypeEnum = z.enum([
  "DUTY_RATE_CORRECTION",
  "VALUE_CORRECTION",
  "CLASSIFICATION_CORRECTION",
  "QUANTITY_CORRECTION",
]);

const createPscSchema = z.object({
  originalFilingId: z.string().min(1, "originalFilingId is required"),
  refundOpportunityId: z.string().optional(),
  reason: z.string().optional(),
  correctionType: PscCorrectionTypeEnum.default("CLASSIFICATION_CORRECTION"),
  originalDutyAmount: z.number().nonnegative().optional(),
  correctedDutyAmount: z.number().nonnegative({ message: "correctedDutyAmount is required and must be a non-negative number" }),
  correctedHtsCode: z.string().optional(),
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

  const { originalFilingId, refundOpportunityId, reason, correctionType, originalDutyAmount, correctedDutyAmount, correctedHtsCode } = bodyVal.data;

  if (refundOpportunityId) {
    const opp = await db.refundOpportunity.findFirst({
      where: { id: refundOpportunityId, accountId: ctx.accountId },
    });
    if (!opp) {
      return buildErrorResponse(404, "NOT_FOUND", "Refund opportunity not found", undefined, requestId);
    }
  }

  // 1. Fetch filing with line items
  const filing = await db.customsFiling.findFirst({
    where: { id: originalFilingId, accountId: ctx.accountId },
    include: { shipment: { include: { lineItems: true } } },
  });

  if (!filing) {
    return buildErrorResponse(404, "NOT_FOUND", "Original filing not found", undefined, requestId);
  }

  // 2. Validate PSC eligibility (Task D-2)
  const eligibility = await checkPscEligibility(ctx.accountId, originalFilingId);
  if (!eligibility.eligible) {
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", eligibility.reason, undefined, requestId);
  }

  // 3. Compute original duty using Decimal / filing declaration
  const origDutyDec = originalDutyAmount !== undefined 
    ? new Decimal(originalDutyAmount) 
    : (filing.totalDuties ? new Decimal(filing.totalDuties) : new Decimal(0));

  if (origDutyDec.isZero()) {
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", "PSC calculation requires actual duty paid from accepted filing data.", undefined, requestId);
  }

  // Task D-4: Calculate corrected duty via dutyEngine & Decimal math
  let corrDutyDec = new Decimal(correctedDutyAmount);

  if (correctedHtsCode && filing.shipment?.lineItems?.[0]) {
    const item = filing.shipment.lineItems[0];
    const htsMap = await loadHtsCodesMap([{ htsCode: correctedHtsCode }]);
    const htsInput = htsMap[correctedHtsCode] ?? null;
    const stack = calculateDutyStack(
      {
        htsCode: correctedHtsCode,
        totalValue: Number(item.totalValue || 0),
        countryOfOrigin: item.countryOfOrigin,
      },
      htsInput
    );
    corrDutyDec = stack.total;
  }

  // Decimal precision math for refund amount
  const refundAmountDec = roundToCents(Decimal.max(0, origDutyDec.minus(corrDutyDec)));

  const psc = await db.postSummaryCorrection.create({
    data: {
      accountId: ctx.accountId,
      originalFilingId,
      refundOpportunityId,
      reason: reason ?? "Post-Summary Correction",
      correctionType,
      originalDutyAmount: roundToCents(origDutyDec),
      correctedDutyAmount: roundToCents(corrDutyDec),
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
    metadata: { originalFilingId, refundAmount: refundAmountDec.toNumber(), correctionType },
  });

  return NextResponse.json({ psc, requestId });

}, { permission: "refunds.manage", write: true });
