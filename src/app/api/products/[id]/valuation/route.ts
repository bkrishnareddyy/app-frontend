import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { calculateCustomsValuation, ValuationInput } from "@/lib/valuation/valuationEngine";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { createExceptionItem } from "@/lib/exceptions/createException";

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const { id: productId } = params;
  const url = new URL(req.url);
  const shipmentLineItemId = url.searchParams.get("shipmentLineItemId");

  if (!shipmentLineItemId) {
    return NextResponse.json({ productId, record: null });
  }

  const lineItem = await db.shipmentLineItem.findFirst({
    where: { id: shipmentLineItemId, accountId: ctx.accountId },
  });

  if (!lineItem) {
    return NextResponse.json({ productId, record: null });
  }

  const filing = await db.customsFiling.findFirst({
    where: { shipmentId: lineItem.shipmentId, accountId: ctx.accountId },
    include: { valuationAssistsRecord: true },
  });

  return NextResponse.json({
    productId,
    shipmentLineItemId,
    record: filing?.valuationAssistsRecord ?? null,
  });
}, { permission: "products.read", write: false });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const { id: productId } = params;
  const body = (await req.json()) as ValuationInput & { shipmentLineItemId?: string };

  const valuationResult = calculateCustomsValuation(body);

  if (body.shipmentLineItemId) {
    const lineItem = await db.shipmentLineItem.findFirst({
      where: { id: body.shipmentLineItemId, accountId: ctx.accountId },
    });

    if (lineItem) {
      // Task C-3: Flag related-party transaction and create ExceptionItem if relatedParty is true
      if (valuationResult.relatedParty) {
        await createExceptionItem({
          accountId: ctx.accountId,
          shipmentId: lineItem.shipmentId,
          category: "VALUATION",
          type: "compliance_flag",
          severity: "High",
          status: "Open",
          description: `Line item ${lineItem.lineNumber} (${lineItem.description}) is a related-party transaction. Broker must document arm's-length transaction value test.`,
        });
      }

      // Task C-4: Persist ValuationAssistsRecord so input & calculated state are preserved
      let filing = await db.customsFiling.findFirst({
        where: { shipmentId: lineItem.shipmentId, accountId: ctx.accountId },
      });

      if (!filing) {
        filing = await db.customsFiling.create({
          data: {
            accountId: ctx.accountId,
            shipmentId: lineItem.shipmentId,
            authority: "US_CBP",
            entryNumber: `ENTRY-${lineItem.shipmentId.slice(0, 8)}`,
            entryType: "01",
            filingType: "ENTRY_SUMMARY",
            filingStatus: "Draft",
          },
        });
      }

      await db.valuationAssistsRecord.upsert({
        where: { filingId: filing.id },
        create: {
          accountId: ctx.accountId,
          filingId: filing.id,
          declaredValue: valuationResult.customsValue,
          transferPricingMatch: !valuationResult.relatedParty,
          freightIncluded: Number(body.freightToUSPort || 0) === 0,
          insuranceIncluded: Number(body.insuranceToUSPort || 0) === 0,
          potentialAssists: body.assists ? (body.assists as any) : [],
          relatedPartyTransaction: valuationResult.relatedParty,
          status: "Verified",
        },
        update: {
          declaredValue: valuationResult.customsValue,
          transferPricingMatch: !valuationResult.relatedParty,
          freightIncluded: Number(body.freightToUSPort || 0) === 0,
          insuranceIncluded: Number(body.insuranceToUSPort || 0) === 0,
          potentialAssists: body.assists ? (body.assists as any) : [],
          relatedPartyTransaction: valuationResult.relatedParty,
          status: "Verified",
        },
      });
    }
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.PRODUCT_UPDATED,
    entity: "ProductValuation",
    entityId: productId,
    source: "API",
    metadata: {
      declaredValue: valuationResult.customsValue,
      relatedParty: valuationResult.relatedParty,
    },
  });

  return NextResponse.json({
    productId,
    valuation: valuationResult,
  });

}, { permission: "products.edit", write: true });
