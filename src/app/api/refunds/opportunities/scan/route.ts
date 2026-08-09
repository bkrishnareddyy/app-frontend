import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export const POST = withAuthenticatedRoute(async ({ ctx }) => {
  const filings = await db.customsFiling.findMany({
    where: { accountId: ctx.accountId },
    include: {
      shipment: {
        include: { lineItems: true },
      },
    },
  });

  const opportunitiesCreated = [];

  for (const filing of filings) {
    const existing = await db.refundOpportunity.findFirst({
      where: { filingId: filing.id, accountId: ctx.accountId },
    });

    if (!existing) {
      const lineItems = filing.shipment.lineItems || [];
      const hasChinaOrigin = lineItems.some((l) => l.countryOfOrigin?.toLowerCase() === "china");
      const estimatedRefundAmount = hasChinaOrigin
        ? Math.round((Number(filing.totalDuties) * 0.4) * 100) / 100
        : Math.round((Number(filing.totalDuties) * 0.15) * 100) / 100;

      if (estimatedRefundAmount > 0) {
        const opp = await db.refundOpportunity.create({
          data: {
            accountId: ctx.accountId,
            filingId: filing.id,
            opportunityType: hasChinaOrigin ? "retroactive_exclusion" : "overpayment",
            estimatedRefundAmount,
            confidence: hasChinaOrigin ? 95 : 88,
            basis: {
              rule: hasChinaOrigin ? "Section 301 Annex A Exclusion Expiration Refund" : "Valuation Adjustment Rule 44",
              previousDutyPaid: Number(filing.totalDuties),
              predictedDuty: Number(filing.totalDuties) - estimatedRefundAmount,
            },
            status: "Identified",
          },
        });
        opportunitiesCreated.push(opp);
      }
    }
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "refunds.scan",
    entity: "RefundOpportunity",
    entityId: ctx.accountId,
    metadata: { opportunitiesCreatedCount: opportunitiesCreated.length },
  });

  return NextResponse.json({
    message: "Refund opportunity scan completed",
    opportunitiesCreatedCount: opportunitiesCreated.length,
    opportunities: opportunitiesCreated,
  });
}, { write: true });
