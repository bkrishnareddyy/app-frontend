import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { calculateCustomsValuation, ValuationInput } from "@/lib/valuation/valuationEngine";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { ExchangeRateService } from "@/modules/fx/exchangeRateService";

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

  // If this valuation is tied to a real shipment line item, resolve the rate
  // as of that shipment's date of export (ladingDate) rather than today's
  // rate -- same reasoning as filing.service.ts. An ad-hoc valuation with no
  // line item has no shipment to anchor a date to, so it falls back to the
  // current rate.
  let asOfDate: Date | undefined;
  if (body.shipmentLineItemId) {
    const lineItemForRate = await db.shipmentLineItem.findFirst({
      where: { id: body.shipmentLineItemId, accountId: ctx.accountId },
      include: { shipment: { select: { ladingDate: true } } },
    });
    asOfDate = lineItemForRate?.shipment?.ladingDate ?? undefined;
  }

  // valuationEngine is USD-only -- convert every monetary field to USD here,
  // at the call site, before handing off. keep the engine itself untouched.
  const invoiceCurrency = body.currency || "USD";
  const rateToUsd = (await ExchangeRateService.resolveExchangeRate(invoiceCurrency, asOfDate)).toNumber();
  const usdInput: ValuationInput = {
    ...body,
    currency: "USD",
    invoiceValue: Number(body.invoiceValue || 0) * rateToUsd,
    assists: body.assists?.map((assist) => ({
      ...assist,
      unitCost: Number(assist.unitCost || 0) * rateToUsd,
    })),
    royalties: Number(body.royalties || 0) * rateToUsd,
    commissions: Number(body.commissions || 0) * rateToUsd,
    freightToUSPort: Number(body.freightToUSPort || 0) * rateToUsd,
    insuranceToUSPort: Number(body.insuranceToUSPort || 0) * rateToUsd,
    discounts: Number(body.discounts || 0) * rateToUsd,
  };

  const valuationResult = calculateCustomsValuation(usdInput);

  if (body.shipmentLineItemId) {
    const lineItem = await db.shipmentLineItem.findFirst({
      where: { id: body.shipmentLineItemId, accountId: ctx.accountId },
    });

    if (lineItem) {
      // Task C-3: Flag related-party transaction and create ExceptionItem if relatedParty is true
      if (valuationResult.relatedParty) {
        await db.exceptionItem.create({
          data: {
            accountId: ctx.accountId,
            shipmentId: lineItem.shipmentId,
            category: "VALUATION",
            type: "compliance_flag",
            severity: "High",
            status: "Open",
            description: `Line item ${lineItem.lineNumber} (${lineItem.description}) is a related-party transaction. Broker must document arm's-length transaction value test.`,
          },
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
      invoiceCurrency,
      rateToUsd,
      rateAsOfDate: asOfDate?.toISOString() ?? null,
    },
  });

  return NextResponse.json({
    productId,
    valuation: valuationResult,
  });

}, { permission: "products.edit", write: true });
