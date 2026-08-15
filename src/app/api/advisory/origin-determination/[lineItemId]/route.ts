import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { determineOrigin } from "@/lib/origin/originEngine";

export const POST = withAuthenticatedRoute<{ lineItemId: string }>(async ({ ctx, params }) => {
  const { lineItemId } = params;

  const lineItem = await db.shipmentLineItem.findFirst({
    where: { id: lineItemId, accountId: ctx.accountId },
    include: {
      product: {
        include: { compositions: true },
      },
      origins: { include: { tradeAgreement: true } },
    },
});

  if (!lineItem) {
    return NextResponse.json({ error: "Shipment line item not found" });
  }

  const tradeAgreementCode = lineItem.origins[0]?.tradeAgreement.code;

  const result = determineOrigin({
    product: {
      id: lineItem.productId ?? undefined,
      htsCode: lineItem.htsCode,
      description: lineItem.description,
      price: Number(lineItem.totalValue),
    },
    materials: lineItem.product?.compositions.map((c) => ({
      id: c.id,
      name: c.material,
      cost: c.percentage ? Number(c.percentage) : null,
    })) ?? [],
    claimedCountry: lineItem.countryOfOrigin,
    tradeAgreementCode,
  });

  if (lineItem.origins.length > 0) {
    await db.originDetermination.update({
      where: { id: lineItem.origins[0].id },
      data: {
        qualifies: result.qualifies,
        criterion: result.basis,
        regionalValueContentPct: result.regionalValueContentPct ?? null,
      },
    });
  }

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: "advisory.origin.re-evaluated",
    entity: "ShipmentLineItem",
    entityId: lineItemId,
    source: "UI",
    metadata: { result: result as unknown as Record<string, unknown> },
  });

  return NextResponse.json({ lineItemId, reevaluated: true, analysis: result });

}, { permission: "ai.use", write: true });
