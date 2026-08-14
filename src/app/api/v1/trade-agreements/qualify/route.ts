import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { determineOrigin } from "@/lib/origin/originEngine";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { lineItemId, agreementCode, agreementId } = body;

  if (!lineItemId) {
    return NextResponse.json({ error: "lineItemId is required" });
  }

  let code = agreementCode;
  if (!code && agreementId) {
    const ta = await db.tradeAgreement.findUnique({ where: { id: agreementId } });
    if (ta) code = ta.code;
  }

  if (!code) {
    return NextResponse.json({ error: "agreementCode or valid agreementId is required" }, { status: 400 });
  }

  const lineItem = await db.shipmentLineItem.findFirst({
    where: { id: lineItemId, accountId: ctx.accountId },
    include: {
      product: {
        include: { compositions: true },
      },
    },
});

  if (!lineItem) {
    return NextResponse.json({ error: "Shipment line item not found" }, { status: 404 });
  }

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
      htsCode: (c as any).htsCode ?? null,
      cost: c.percentage ? Number(c.percentage) : null,
    })) ?? [],
    claimedCountry: lineItem.countryOfOrigin,
    tradeAgreementCode: code,
  });

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.ORIGIN_DETERMINED,
    entity: "ShipmentLineItem",
    entityId: lineItemId,
    source: "API",
    metadata: {
      agreementCode: code,
      qualified: result.qualifies,
      confidence: result.confidence,
      basis: result.basis,
    },
  });

  return NextResponse.json({
    lineItemId,
    agreementCode: code,
    qualified: result.qualifies,
    confidence: result.confidence,
    basis: result.basis,
    regionalValueContentPct: result.regionalValueContentPct ?? null,
    gaps: result.gaps,
  });

}, { permission: "intel.read", write: true });
