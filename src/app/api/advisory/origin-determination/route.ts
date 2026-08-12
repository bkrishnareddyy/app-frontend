import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";

/** Agreements a determination can be recorded against, with their real names. */
const TRADE_AGREEMENTS: Record<string, string> = {
  USMCA: "United States-Mexico-Canada Agreement",
  KORUS: "Korea-United States Free Trade Agreement",
  "CAFTA-DR": "Dominican Republic-Central America-United States Free Trade Agreement",
  "US-Israel": "United States-Israel Free Trade Area Agreement",
};

const CALCULATION_METHODS = ["net cost", "transaction value"];

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const body = await req.json();
  const { shipmentLineItemId, tradeAgreementCode, criterion, regionalValueContentPct, calculationMethod, qualifies } = body;

  if (!shipmentLineItemId) {
    return NextResponse.json({ error: "shipmentLineItemId is required" }, { status: 400 });
  }

  // This endpoint performs no origin analysis, so it cannot decide any of
  // these. They used to default to a qualifying result: qualifies true,
  // "Criterion A (Wholly Obtained)", 65% RVC, net cost, status Confirmed —
  // an unevaluated line item recorded as entitled to FTA preference.
  if (typeof qualifies !== "boolean") {
    return NextResponse.json(
      { error: "qualifies is required and must be a boolean" },
      { status: 400 }
    );
  }
  if (typeof criterion !== "string" || criterion.trim() === "") {
    return NextResponse.json({ error: "criterion is required" }, { status: 400 });
  }
  if (!CALCULATION_METHODS.includes(calculationMethod)) {
    return NextResponse.json(
      { error: `calculationMethod must be one of: ${CALCULATION_METHODS.join(", ")}` },
      { status: 400 }
    );
  }

  let rvc: number | null = null;
  if (regionalValueContentPct !== undefined && regionalValueContentPct !== null) {
    if (typeof regionalValueContentPct !== "number" || !Number.isFinite(regionalValueContentPct) || regionalValueContentPct < 0 || regionalValueContentPct > 100) {
      return NextResponse.json(
        { error: "regionalValueContentPct must be a number between 0 and 100" },
        { status: 400 }
      );
    }
    rvc = regionalValueContentPct;
  }

  const agreementName = TRADE_AGREEMENTS[tradeAgreementCode];
  if (!agreementName) {
    return NextResponse.json(
      { error: `tradeAgreementCode must be one of: ${Object.keys(TRADE_AGREEMENTS).join(", ")}` },
      { status: 400 }
    );
  }

  const lineItem = await db.shipmentLineItem.findFirst({
    where: { id: shipmentLineItemId, accountId: ctx.accountId },
    // filingDeadline is in the Prisma schema but not yet applied to the live
    // DB (migration pending) -- must stay omitted or this 500s.
    include: { shipment: { omit: { filingDeadline: true } } },
  });

  if (!lineItem) {
    return NextResponse.json({ error: "Shipment line item not found" }, { status: 404 });
  }

  // Was created on demand from the caller's code, naming anything that was
  // not USMCA "Korea-US Free Trade Agreement (KORUS)".
  const agreement = await db.tradeAgreement.upsert({
    where: { code: tradeAgreementCode },
    update: {},
    create: { code: tradeAgreementCode, name: agreementName },
  });

  const originDetermination = await db.originDetermination.create({
    data: {
      shipmentLineItemId,
      tradeAgreementId: agreement.id,
      qualifies,
      criterion,
      regionalValueContentPct: rvc,
      calculationMethod,
      // Recording an assertion is not confirming it; confirmation is a
      // separate review step.
      status: "Draft",
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
    metadata: { shipmentLineItemId, tradeAgreementCode, qualifies, criterion, calculationMethod },
  });

  return NextResponse.json({ originDetermination }, { status: 201 });
}, { write: true });
