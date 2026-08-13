import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { screenForAdcvd } from "@/lib/adcvd/scopeScreening";

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const { id: productId } = params;
  const body = await req.json().catch(() => ({}));
  const { htsCode, countryOfOrigin, productDescription, shipmentId, shipmentLineItemId } = body;

  let targetHts = htsCode;
  let targetCountry = countryOfOrigin;
  let targetDesc = productDescription;

  if (productId && productId !== "unknown") {
    const product = await db.product.findFirst({
      where: { id: productId, accountId: ctx.accountId },
      include: { countryFacts: true },
    });
    if (product) {
      targetCountry = targetCountry || product.countryFacts[0]?.rawCountry;
      targetDesc = targetDesc || product.customsDescription || product.commercialDescription || product.productName;
    }
  }

  if (shipmentLineItemId) {
    const lineItem = await db.shipmentLineItem.findFirst({
      where: { id: shipmentLineItemId, accountId: ctx.accountId },
    });
    if (lineItem) {
      targetHts = targetHts || lineItem.htsCode;
      targetCountry = targetCountry || lineItem.countryOfOrigin;
      targetDesc = targetDesc || lineItem.description;
    }
  }

  const result = await screenForAdcvd({
    htsCode: targetHts,
    countryOfOrigin: targetCountry,
    productDescription: targetDesc,
  });

  // Task E-4: Create ExceptionItem for YES or POSSIBLY results
  for (const order of result.orders) {
    if (order.inScope === "YES" || order.inScope === "POSSIBLY") {
      const targetShipmentId = shipmentId || body.shipmentId;
      if (targetShipmentId) {
        await db.exceptionItem.create({
          data: {
            accountId: ctx.accountId,
            shipmentId: targetShipmentId,
            category: "COMPLIANCE",
            type: "compliance_flag",
            severity: order.inScope === "YES" ? "Critical" : "High",
            status: "Open",
            description: `AD/CVD Order Scope Match (${order.caseNumber}): ${order.inScope}. Title: "${order.title}". ${order.reasoning}`,
          },
        });
      }
    }
  }

  return NextResponse.json({
    productId,
    htsCode: targetHts,
    countryOfOrigin: targetCountry,
    screening: result,
  });
}, { permission: "documents.create", write: true });
