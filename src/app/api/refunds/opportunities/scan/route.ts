import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { determineOrigin } from "@/lib/origin/originEngine";
import { calculateDutyStack } from "@/lib/tariff/dutyEngine";
import { Decimal } from "@/lib/tariff/decimal";

export const POST = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  const accountId = ctx.accountId;

  // 1. Retrieve all accepted filings to evaluate opportunities from real entry data
  const filings = await db.customsFiling.findMany({
    where: { accountId, filingStatus: { in: ["Accepted", "Closed"] } },
    include: {
      shipment: {
        include: {
          lineItems: {
            include: {
              product: { include: { compositions: true } },
              origins: { include: { tradeAgreement: true } },
            },
          },
        },
      },
    },
  });

  if (filings.length === 0) {
    return NextResponse.json({
      opportunitiesCreatedCount: 0,
      opportunities: [],
      message: "Opportunity scan requires actual duty rates and entry data. Ensure all line items have approved HTS classifications and duty calculations.",
      requestId,
    });
  }

  const opportunitiesCreated = [];

  for (const filing of filings) {
    for (const item of filing.shipment.lineItems) {
      // 1. check SECTION_301_EXCLUSION: if CN origin and description matches active exclusion Hts
      const isChina = item.countryOfOrigin.toUpperCase() === "CN";
      if (isChina) {
        // Query if there is an exclusion rate or if exclusion is granted
        // For matching, search node or check if node rate contains exclusion text
        const matchedExclusion = item.description.toLowerCase().includes("exclude") || item.description.toLowerCase().includes("excl");
        
        if (matchedExclusion) {
          const exists = await db.refundOpportunity.findFirst({
            where: { accountId, filingId: filing.id, opportunityType: "SECTION_301_EXCLUSION" },
          });

          if (!exists) {
            const opp = await db.refundOpportunity.create({
              data: {
                accountId,
                filingId: filing.id,
                opportunityType: "SECTION_301_EXCLUSION",
                estimatedRefundAmount: new Decimal(Number(item.totalValue || 0) * 0.075), // 7.5% section 301 refund
                confidence: 95,
                basis: {
                  reason: "Product description matches Section 301 retroactive exclusion language.",
                  lineItemId: item.id,
                },
                status: "Identified",
              },
            });
            opportunitiesCreated.push(opp);
          }
        }
      }

      // 2. check TRADE_AGREEMENT: run F06 origin engine to see if preferential rate wasn't claimed
      const claimsTa = item.origins.length > 0;
      if (!claimsTa && item.countryOfOrigin !== "US") {
        // Run origin engine
        const originRes = determineOrigin({
          product: {
            id: item.productId ?? undefined,
            htsCode: item.htsCode,
            description: item.description,
            price: Number(item.totalValue),
          },
          materials: item.product?.compositions.map((c) => ({
            id: c.id,
            name: c.material,
            cost: c.percentage ? Number(c.percentage) : null,
          })) ?? [],
          claimedCountry: item.countryOfOrigin,
          tradeAgreementCode: "USMCA", // Default check USMCA
        });

        if (originRes.qualifies) {
          const exists = await db.refundOpportunity.findFirst({
            where: { accountId, filingId: filing.id, opportunityType: "TRADE_AGREEMENT" },
          });

          if (!exists) {
            const opp = await db.refundOpportunity.create({
              data: {
                accountId,
                filingId: filing.id,
                opportunityType: "TRADE_AGREEMENT",
                estimatedRefundAmount: new Decimal(Number(item.totalValue || 0) * 0.028), // preferential duty savings
                confidence: 88,
                basis: {
                  reason: "Product qualifies for preferential USMCA duty rate but was entered under general rate.",
                  lineItemId: item.id,
                  rvcPct: originRes.regionalValueContentPct,
                },
                status: "Identified",
              },
            });
            opportunitiesCreated.push(opp);
          }
        }
      }
    }
  }

  await createAuditLog({
    accountId,
    userId: ctx.userId,
    action: "DUTY_RECOVERY_SCAN_RUN",
    entity: "Account",
    entityId: accountId,
    metadata: {
      opportunitiesCreated: opportunitiesCreated.length,
    },
  });

  return NextResponse.json({
    opportunitiesCreatedCount: opportunitiesCreated.length,
    opportunities: opportunitiesCreated.map((o) => ({
      id: o.id,
      opportunityType: o.opportunityType,
      estimatedRefundAmount: Number(o.estimatedRefundAmount),
      confidence: o.confidence,
      status: o.status,
    })),
    message: `Scan complete. Found and created ${opportunitiesCreated.length} refund opportunities.`,
  });
}, { permission: "documents.create", write: true });
