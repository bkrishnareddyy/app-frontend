import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { buildErrorResponse } from "@/lib/api/error";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { checkPscEligibility } from "@/lib/refunds/pscEligibility";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const psc = await db.postSummaryCorrection.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      originalFiling: {
        include: {
          shipment: {
            include: {
              complianceDeadlines: { where: { type: "PSC_WINDOW" }, take: 1 },
            },
          },
        },
      },
      refundOpportunity: true,
      Attachments: { orderBy: { uploadedAt: "desc" } },
    },
  });

  if (!psc) {
    return buildErrorResponse(404, "NOT_FOUND", "PSC not found", undefined, requestId);
  }

  return NextResponse.json({ psc, requestId });
}, { permission: "psc.read" });

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const psc = await db.postSummaryCorrection.findFirst({
    where: { id, accountId: ctx.accountId },
  });
  if (!psc) {
    return buildErrorResponse(404, "NOT_FOUND", "PSC not found", undefined, requestId);
  }

  // Only drafts are editable
  if (psc.status !== "Draft") {
    return buildErrorResponse(
      422,
      "BUSINESS_RULE_FAILURE",
      `PSC in status '${psc.status}' cannot be edited. Only Draft PSCs are editable.`,
      undefined,
      requestId
    );
  }

  const body = await req.json();
  const { legalBasis, notes, correctionType, correctedHtsCode, correctedValue, correctedQuantity, lineItemsAffected, reason } = body;

  const updateData: Record<string, unknown> = {};
  if (legalBasis !== undefined) updateData.legalBasis = legalBasis;
  if (notes !== undefined) updateData.notes = notes;
  if (reason !== undefined) updateData.reason = reason;
  if (correctionType !== undefined) updateData.correctionType = correctionType;
  if (correctedHtsCode !== undefined) updateData.correctedHtsCode = correctedHtsCode;
  if (correctedValue !== undefined) updateData.correctedValue = correctedValue;
  if (correctedQuantity !== undefined) updateData.correctedQuantity = correctedQuantity;
  if (lineItemsAffected !== undefined) updateData.lineItemsAffected = lineItemsAffected;

  const updated = await db.postSummaryCorrection.update({
    where: { id },
    data: updateData,
    include: { originalFiling: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.REFUND_PSC_UPDATED,
    entity: "PostSummaryCorrection",
    entityId: id,
    source: "UI",
    metadata: { updatedFields: Object.keys(updateData) },
  });

  return NextResponse.json({ psc: updated, requestId });
}, { permission: "psc.create", write: true });
