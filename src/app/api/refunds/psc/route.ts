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
  correctedDutyAmount: z.number().nonnegative({
    message: "correctedDutyAmount is required and must be a non-negative number",
  }),
  correctedHtsCode: z.string().optional(),
  correctedValue: z.number().nonnegative().optional(),
  correctedQuantity: z.number().nonnegative().optional(),
  legalBasis: z.string().optional(),
  lineItemsAffected: z.array(z.object({
    lineItemId: z.string(),
    field: z.string(),
    originalValue: z.string(),
    correctedValue: z.string(),
  })).optional(),
  notes: z.string().optional(),
});

const listQuerySchema = z.object({
  status: z.string().optional(),
  correctionType: z.string().optional(),
  filingId: z.string().optional(),
});

export const GET = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const url = new URL(req.url);
  const query = listQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    correctionType: url.searchParams.get("correctionType") ?? undefined,
    filingId: url.searchParams.get("filingId") ?? undefined,
  });

  const where: Record<string, unknown> = { accountId: ctx.accountId };
  if (query.success) {
    if (query.data.status) where.status = query.data.status;
    if (query.data.correctionType) where.correctionType = query.data.correctionType;
    if (query.data.filingId) where.originalFilingId = query.data.filingId;
  }

  const pscs = await db.postSummaryCorrection.findMany({
    where,
    include: {
      originalFiling: {
        include: {
          shipment: {
            include: {
              complianceDeadlines: {
                where: { type: "PSC_WINDOW" },
                take: 1,
              },
            },
          },
        },
      },
      refundOpportunity: true,
      Attachments: { orderBy: { uploadedAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ pscs, requestId });
}, { permission: "psc.read" });

export const POST = withAuthenticatedRoute(async ({ req, ctx, requestId }) => {
  const bodyVal = await parseAndValidateBody(req, createPscSchema, requestId);
  if ("response" in bodyVal) return bodyVal.response;

  const {
    originalFilingId,
    refundOpportunityId,
    reason,
    correctionType,
    originalDutyAmount,
    correctedDutyAmount,
    correctedHtsCode,
    correctedValue,
    correctedQuantity,
    legalBasis,
    lineItemsAffected,
    notes,
  } = bodyVal.data;

  if (refundOpportunityId) {
    const opp = await db.refundOpportunity.findFirst({
      where: { id: refundOpportunityId, accountId: ctx.accountId },
    });
    if (!opp) {
      return buildErrorResponse(404, "NOT_FOUND", "Refund opportunity not found", undefined, requestId);
    }
  }

  const filing = await db.customsFiling.findFirst({
    where: { id: originalFilingId, accountId: ctx.accountId },
    include: { shipment: { include: { lineItems: true } } },
  });

  if (!filing) {
    return buildErrorResponse(404, "NOT_FOUND", "Original filing not found", undefined, requestId);
  }

  const eligibility = await checkPscEligibility(ctx.accountId, originalFilingId);
  if (!eligibility.eligible) {
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", eligibility.reason, undefined, requestId);
  }

  const origDutyDec =
    originalDutyAmount !== undefined
      ? new Decimal(originalDutyAmount)
      : filing.totalDuties
      ? new Decimal(filing.totalDuties)
      : new Decimal(0);

  if (origDutyDec.isZero()) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      "PSC calculation requires actual duty paid from accepted filing data.",
      undefined,
      requestId
    );
  }

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

  const refundAmountDec = roundToCents(Decimal.max(0, origDutyDec.minus(corrDutyDec)));
  const dutyDeltaDec = roundToCents(corrDutyDec.minus(origDutyDec)); // positive = owe more

  // Estimate interest if duty delta is positive (IRS underpayment rate ≈ 8% annualized as at 2024 Q4)
  let interestEstimate: Decimal | undefined;
  if (dutyDeltaDec.gt(0) && filing.submittedAt) {
    const daysSinceEntry = Math.max(
      0,
      Math.floor((Date.now() - new Date(filing.submittedAt).getTime()) / (1000 * 60 * 60 * 24))
    );
    const IRS_RATE = 0.08;
    interestEstimate = roundToCents(dutyDeltaDec.times(IRS_RATE).times(daysSinceEntry / 365));
  }

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
      dutyDelta: dutyDeltaDec,
      interestEstimate: interestEstimate ?? null,
      correctedHtsCode: correctedHtsCode ?? null,
      correctedValue: correctedValue != null ? new Decimal(correctedValue) : null,
      correctedQuantity: correctedQuantity != null ? new Decimal(correctedQuantity) : null,
      legalBasis: legalBasis ?? null,
      lineItemsAffected: lineItemsAffected ? (lineItemsAffected as any) : undefined,
      notes: notes ?? null,
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
    metadata: {
      originalFilingId,
      refundAmount: refundAmountDec.toNumber(),
      dutyDelta: dutyDeltaDec.toNumber(),
      correctionType,
    },
  });

  return NextResponse.json({ psc, requestId });
}, { permission: "psc.create", write: true });
