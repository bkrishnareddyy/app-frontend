import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
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
        include: { shipment: true },
      },
      refundOpportunity: true,
    },
  });

  if (!psc) {
    return NextResponse.json({ error: "PSC not found" }, { status: 404 });
  }

  return NextResponse.json({ psc });
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const body = await req.json();
  const { status, cbpResponseCode, correctedDutyAmount } = body;

  const existingPsc = await db.postSummaryCorrection.findFirst({
    where: { id, accountId: ctx.accountId },
  });

  if (!existingPsc) {
    return NextResponse.json({ error: "PSC not found" }, { status: 404 });
  }

  const updateData: import("@prisma/client").Prisma.PostSummaryCorrectionUpdateInput = {};
  if (status) {
    return NextResponse.json(
      { error: "Forbidden: State mutations must be performed via the workflow engine." },
      { status: 403 }
    );
  }

  if (cbpResponseCode) updateData.cbpResponseCode = cbpResponseCode;
  if (correctedDutyAmount !== undefined) {
    updateData.correctedDutyAmount = correctedDutyAmount;
    updateData.refundAmount = Math.max(0, Number(existingPsc.originalDutyAmount) - correctedDutyAmount);
  }

  const updatedPsc = await db.postSummaryCorrection.update({
    where: { id },
    data: updateData,
    include: { originalFiling: true },
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "psc.update",
    entity: "PostSummaryCorrection",
    entityId: id,
    metadata: { newStatus: status || existingPsc.status },
  });

  return NextResponse.json({ psc: updatedPsc });
}, { write: true });
