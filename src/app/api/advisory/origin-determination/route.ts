import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { createExceptionItem } from "@/lib/exceptions/createException";
import { determineOrigin } from "@/lib/origin/originEngine";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { shipmentLineItemId, tradeAgreementCode, claimedCountry } = body;

  if (!shipmentLineItemId) {
    return NextResponse.json({ error: "shipmentLineItemId is required" }, { status: 400 });
  }

  const lineItem = await db.shipmentLineItem.findFirst({
    where: { id: shipmentLineItemId, accountId: ctx.accountId },
    include: {
      shipment: true,
      product: {
        include: {
          compositions: true,
          countryFacts: true,
        },
      },
    },
});

  if (!lineItem) {
    return NextResponse.json({ error: "Shipment line item not found" }, { status: 404 });
  }

  // Task A-1: Look up trade agreement. Never auto-create inside route handler.
  let agreementId: string | null = null;
  if (tradeAgreementCode) {
    const agreement = await db.tradeAgreement.findUnique({
      where: { code: tradeAgreementCode },
    });
    if (!agreement) {
      return NextResponse.json(
        { error: `Trade agreement "${tradeAgreementCode}" not found. Agreements must be pre-seeded.` },
        { status: 404 }
      );
    }
    agreementId = agreement.id;
  }

  const targetCountry = claimedCountry || lineItem.countryOfOrigin;

  // Run origin engine
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
    claimedCountry: targetCountry,
    tradeAgreementCode: tradeAgreementCode ?? undefined,
  });

  // Task A-4: Save OriginDetermination row
  let originDetermination = null;
  if (agreementId) {
    originDetermination = await db.originDetermination.create({
      data: {
        shipmentLineItemId,
        tradeAgreementId: agreementId,
        qualifies: result.qualifies,
        criterion: result.basis,
        regionalValueContentPct: result.regionalValueContentPct ?? null,
        calculationMethod: "net cost",
        status: "Draft",
      },
      include: { tradeAgreement: true },
    });
  }

  // Task A-5: Low confidence (< 80%) creates ExceptionItem for review
  if (result.confidence < 80) {
    await createExceptionItem({
      accountId: ctx.accountId,
      shipmentId: lineItem.shipmentId,
      category: "COMPLIANCE",
      type: "compliance_flag",
      severity: "High",
      status: "Open",
      description: `Low Confidence Origin Determination (${result.confidence}%) for Line ${lineItem.lineNumber} (${lineItem.description}). Gaps: ${result.gaps.map((g) => g.missing).join("; ") || "Substantial transformation uncertain"}`,
    });
  }

  const auditSource = (req.headers?.get?.("x-qubere-source") === "CHAT" || body?.source === "CHAT") ? "CHAT" : "UI";

  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.ORIGIN_DETERMINED,
    entity: "ShipmentLineItem",
    entityId: shipmentLineItemId,
    source: auditSource,
    metadata: {
      tradeAgreementCode,
      qualifies: result.qualifies,
      confidence: result.confidence,
      basis: result.basis,
    },
  });

  return NextResponse.json({
    shipmentLineItemId,
    tradeAgreementCode,
    determination: originDetermination,
    analysis: result,
  });

}, { permission: "ai.use", write: true });
