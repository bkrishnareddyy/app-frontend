import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { calculateCustomsValuation, ValuationInput } from "@/lib/valuation/valuationEngine";

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const { id: productId } = params;
  const body = (await req.json()) as ValuationInput & { shipmentLineItemId?: string };

  const valuationResult = calculateCustomsValuation(body);

  // Task C-3: Flag related-party transaction and create ExceptionItem if relatedParty is true
  if (valuationResult.relatedParty) {
    if (body.shipmentLineItemId) {
      const lineItem = await db.shipmentLineItem.findFirst({
        where: { id: body.shipmentLineItemId, accountId: ctx.accountId },
      });

      if (lineItem) {
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
    }
  }

  return NextResponse.json({
    productId,
    valuation: valuationResult,
  });
}, { permission: "documents.create", write: true });
