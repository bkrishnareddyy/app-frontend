import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { checkPscEligibility } from "@/lib/refunds/pscEligibility";
import { Decimal, roundToCents } from "@/lib/tariff/decimal";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  // 1. Fetch reconciliation issue
  const issue = await db.reconciliationIssue.findFirst({
    where: { id, accountId: ctx.accountId },
    include: { shipment: true },
  });

  if (!issue) {
    return buildErrorResponse(404, "NOT_FOUND", "Reconciliation issue not found", undefined, requestId);
  }

  // 2. Fetch associated filing for this shipment
  const filing = await db.customsFiling.findFirst({
    where: { shipmentId: issue.shipmentId, accountId: ctx.accountId },
  });

  if (!filing) {
    return buildErrorResponse(404, "NOT_FOUND", "No customs filing found for this shipment", undefined, requestId);
  }

  // 3. Check PSC eligibility (Task D-2)
  const eligibility = await checkPscEligibility(ctx.accountId, filing.id);
  if (!eligibility.eligible) {
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", `Cannot convert to PSC: ${eligibility.reason}`, undefined, requestId);
  }

  // Map field discrepancy to PSC correction type
  const typeMap: Record<string, "DUTY_RATE_CORRECTION" | "VALUE_CORRECTION" | "CLASSIFICATION_CORRECTION" | "QUANTITY_CORRECTION"> = {
    htsCode: "CLASSIFICATION_CORRECTION",
    totalValue: "VALUE_CORRECTION",
    quantity: "QUANTITY_CORRECTION",
    dutyRate: "DUTY_RATE_CORRECTION",
  };
  const correctionType = typeMap[issue.field] || "DUTY_RATE_CORRECTION";

  const origDutyDec = filing.totalDuties ? new Decimal(filing.totalDuties) : new Decimal(0);
  const corrDutyDec = origDutyDec.times(0.9); // Default estimated 10% duty adjustment on correction
  const refundAmountDec = roundToCents(Decimal.max(0, origDutyDec.minus(corrDutyDec)));

  // 4. Create PostSummaryCorrection record
  const psc = await db.postSummaryCorrection.create({
    data: {
      accountId: ctx.accountId,
      originalFilingId: filing.id,
      reason: `Converted from Reconciliation Discrepancy (${issue.field}: expected "${issue.expectedValue}" vs actual "${issue.actualValue}")`,
      correctionType,
      originalDutyAmount: roundToCents(origDutyDec),
      correctedDutyAmount: roundToCents(corrDutyDec),
      refundAmount: refundAmountDec,
      status: "Draft",
      createdByUserId: ctx.userId,
    },
  });

  // 5. Update reconciliation issue status
  await db.reconciliationIssue.update({
    where: { id },
    data: {
      status: "Resolved",
      resolvedAt: new Date(),
      resolvedByUserId: ctx.userId,
      note: `Converted to PSC #${psc.id}`,
    },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.REFUND_PSC_CREATED,
    entity: "PostSummaryCorrection",
    entityId: psc.id,
    source: "UI",
    metadata: { reconciliationIssueId: id, correctionType, refundAmount: refundAmountDec.toNumber() },
  });

  return NextResponse.json({
    message: "Reconciliation issue converted to Post-Summary Correction",
    psc,
    requestId,
  });

}, { permission: "refunds.manage", write: true });
