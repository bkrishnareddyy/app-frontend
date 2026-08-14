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
 * POST /api/refunds/psc/[id]/submit
 * Transitions READY_FOR_REVIEW → SUBMITTED.
 * Final eligibility check before marking as submitted to CBP ACE.
 * Requires psc.manage permission.
 */
export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const psc = await db.postSummaryCorrection.findFirst({
    where: { id, accountId: ctx.accountId },
    include: { Attachments: true },
  });

  if (!psc) {
    return buildErrorResponse(404, "NOT_FOUND", "PSC not found", undefined, requestId);
  }
  if (psc.status !== "READY_FOR_REVIEW") {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      `PSC must be in READY_FOR_REVIEW status to submit. Current status: ${psc.status}`,
      undefined,
      requestId
    );
  }

  // Final eligibility check — window must still be open
  const eligibility = await checkPscEligibility(ctx.accountId, psc.originalFilingId);
  if (!eligibility.eligible) {
    return buildErrorResponse(422, "BUSINESS_RULE_FAILURE", eligibility.reason, undefined, requestId);
  }

  const updated = await db.postSummaryCorrection.update({
    where: { id },
    data: {
      status: "SUBMITTED",
      filedAt: new Date(),
    },
    include: { originalFiling: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PSC_SUBMITTED,
    entity: "PostSummaryCorrection",
    entityId: id,
    source: "UI",
    metadata: {
      originalFilingId: psc.originalFilingId,
      refundAmount: Number(psc.refundAmount),
      dutyDelta: Number(psc.dutyDelta ?? 0),
    },
  });

  // Notify users with psc.read permission about submission
  const members = await db.accountMembership.findMany({
    where: { accountId: ctx.accountId },
    select: { userId: true },
  });

  await db.notification.createMany({
    data: members.map((m: { userId: string }) => ({
      accountId: ctx.accountId,
      userId: m.userId,
      type: "PSC_SUBMITTED",
      message: `PSC for entry ${psc.originalFilingId} has been submitted to CBP ACE.`,
      entityType: "PostSummaryCorrection",
      entityId: id,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ psc: updated, requestId });
}, { permission: "psc.manage", write: true });
