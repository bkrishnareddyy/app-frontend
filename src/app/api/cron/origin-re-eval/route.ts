import { NextResponse } from "next/server";
import { withCronRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { determineOrigin } from "@/lib/origin/originEngine";
import { createAuditLog, AuditAction } from "@/lib/audit";

export const maxDuration = 300;

export async function reevaluateProductLineItems(productId: string, accountId: string) {
  const lineItems = await db.shipmentLineItem.findMany({
    where: { productId, accountId },
    include: {
      product: {
        include: { compositions: true },
      },
      origins: { include: { tradeAgreement: true } },
    },
  });

  let updatedCount = 0;
  for (const lineItem of lineItems) {
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
      const before = lineItem.origins[0];
      const changed =
        before.qualifies !== result.qualifies ||
        before.criterion !== result.basis ||
        Number(before.regionalValueContentPct ?? null) !== Number(result.regionalValueContentPct ?? null);

      await db.originDetermination.update({
        where: { id: before.id },
        data: {
          qualifies: result.qualifies,
          criterion: result.basis,
          regionalValueContentPct: result.regionalValueContentPct ?? null,
        },
      });
      updatedCount++;

      // Re-determinations can flip a prior duty-free qualification -- a
      // legally consequential change that must leave the same audit trail
      // as an interactive re-determination (see ORIGIN_DETERMINED in
      // api/advisory/origin-determination). Only logged on actual change to
      // avoid flooding the append-only log with confirmations on every sweep.
      if (changed) {
        await createAuditLog({
          accountId,
          action: AuditAction.ORIGIN_DETERMINED,
          entity: "OriginDetermination",
          entityId: before.id,
          source: "SYSTEM",
          metadata: {
            productId,
            shipmentLineItemId: lineItem.id,
            tradeAgreementCode,
          },
          beforeJson: {
            qualifies: before.qualifies,
            criterion: before.criterion,
            regionalValueContentPct: before.regionalValueContentPct,
          },
          afterJson: {
            qualifies: result.qualifies,
            criterion: result.basis,
            regionalValueContentPct: result.regionalValueContentPct ?? null,
          },
        });
      }
    }
  }
  return { evaluatedLineItems: lineItems.length, updatedDeterminations: updatedCount };
}

async function handleReevaluation(req: Request, requestId: string) {
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId");

  if (productId) {
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    const res = await reevaluateProductLineItems(product.id, product.accountId);
    return NextResponse.json({ status: "COMPLETED", productId, ...res, requestId });
  }

  // Sweep products updated in last 24h
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const updatedFacts = await db.productCountryFact.findMany({
    where: { updatedAt: { gte: oneDayAgo } },
    select: { productId: true, accountId: true },
  });

  const uniqueProducts = Array.from(new Set(updatedFacts.map((f) => `${f.productId}:${f.accountId}`)));
  let totalEvaluated = 0;
  let totalUpdated = 0;

  for (const item of uniqueProducts) {
    const [pId, aId] = item.split(":");
    const res = await reevaluateProductLineItems(pId, aId);
    totalEvaluated += res.evaluatedLineItems;
    totalUpdated += res.updatedDeterminations;
  }

  return NextResponse.json({
    status: "COMPLETED",
    productsProcessed: uniqueProducts.length,
    totalEvaluated,
    totalUpdated,
    requestId,
  });
}

export const GET = withCronRoute(async ({ req, requestId }) => {
  return handleReevaluation(req, requestId);
});

export const POST = withCronRoute(async ({ req, requestId }) => {
  return handleReevaluation(req, requestId);
});
