import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { checkPscEligibility } from "@/lib/refunds/pscEligibility";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * POST /api/refunds/psc/[id]/ready
 * Transitions a Draft PSC to READY_FOR_REVIEW.
 * Requires: legalBasis and reason populated.
 */
export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const psc = await db.postSummaryCorrection.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!psc) {
    return buildErrorResponse(404, "NOT_FOUND", "PSC not found", undefined, requestId);
  }
  if (psc.status !== "Draft") {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      `PSC must be in Draft status to mark as Ready. Current status: ${psc.status}`,
      undefined,
      requestId
    );
  }
  if (!psc.legalBasis?.trim()) {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      "A legal basis must be documented before marking a PSC as ready for review.",
      undefined,
      requestId
    );
  }

  // Re-validate eligibility (window may have expired since Draft was created)
  const eligibility = await checkPscEligibility(ctx.accountId, psc.originalFilingId);
  if (!eligibility.eligible) {
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", eligibility.reason, undefined, requestId);
  }

  const updated = await db.postSummaryCorrection.update({
    where: { id },
    data: { status: "READY_FOR_REVIEW", reviewedAt: new Date(), reviewedByUserId: ctx.userId },
    include: { originalFiling: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PSC_READY_FOR_REVIEW,
    entity: "PostSummaryCorrection",
    entityId: id,
    source: "UI",
    metadata: {},
  });

  return NextResponse.json({ psc: updated, requestId });
}, { permission: "psc.create", write: true });
