import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const ctx = await getAccountContext();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { shipmentLineItemId, tradeAgreementCode, criterion, regionalValueContentPct, calculationMethod } = body;

    if (!shipmentLineItemId) {
      return NextResponse.json({ error: "shipmentLineItemId is required" }, { status: 400 });
    }

    const lineItem = await db.shipmentLineItem.findFirst({
      where: { id: shipmentLineItemId, accountId: ctx.accountId },
      include: { shipment: true },
    });

    if (!lineItem) {
      return NextResponse.json({ error: "Shipment line item not found" }, { status: 404 });
    }

    const agreementCode = tradeAgreementCode || "USMCA";

    let agreement = await db.tradeAgreement.findUnique({
      where: { code: agreementCode },
    });

    if (!agreement) {
      agreement = await db.tradeAgreement.create({
        data: {
          code: agreementCode,
          name: agreementCode === "USMCA" ? "United States-Mexico-Canada Agreement" : "Korea-US Free Trade Agreement (KORUS)",
          description: "Free Trade Agreement eligibility qualification rules",
        },
      });
    }

    const originDetermination = await db.originDetermination.create({
      data: {
        shipmentLineItemId,
        tradeAgreementId: agreement.id,
        qualifies: true,
        criterion: criterion || "Criterion A (Wholly Obtained)",
        regionalValueContentPct: regionalValueContentPct || 65.0,
        calculationMethod: calculationMethod || "net cost",
        status: "Confirmed",
      },
      include: {
        tradeAgreement: true,
        shipmentLineItem: true,
      },
    });

    await createAuditLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: "advisory.origin_determination",
      entity: "OriginDetermination",
      entityId: originDetermination.id,
      metadata: { shipmentLineItemId, tradeAgreementCode: agreementCode },
    });

    return NextResponse.json({ originDetermination }, { status: 201 });
  } catch (error) {
    console.error("POST /api/advisory/origin-determination error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
