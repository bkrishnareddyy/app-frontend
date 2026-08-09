import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const GET = withAuthenticatedRoute(async ({ ctx }) => {
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

  return NextResponse.json({ pscs });
});

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { originalFilingId, refundOpportunityId, reason, correctionType, originalDutyAmount, correctedDutyAmount } = body;

  if (!originalFilingId) {
    return NextResponse.json({ error: "originalFilingId is required" }, { status: 400 });
  }

  const filing = await db.customsFiling.findFirst({
    where: { id: originalFilingId, accountId: ctx.accountId },
  });

  if (!filing) {
    return NextResponse.json({ error: "Original filing not found" }, { status: 404 });
  }

  const origDuty = originalDutyAmount !== undefined ? originalDutyAmount : filing.totalDuties;
  const corrDuty = correctedDutyAmount !== undefined ? correctedDutyAmount : Math.round((origDuty * 0.7) * 100) / 100;
  const refundAmount = Math.max(0, origDuty - corrDuty);

  const psc = await db.postSummaryCorrection.create({
    data: {
      accountId: ctx.accountId,
      originalFilingId,
      refundOpportunityId,
      reason: reason || "Post-Summary Correction for Tariff Classification Exclusion",
      correctionType: correctionType || "classification",
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

  return NextResponse.json({ psc }, { status: 201 });
});
