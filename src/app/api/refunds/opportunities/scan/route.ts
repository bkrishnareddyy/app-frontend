import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/audit";
import { determineOrigin } from "@/lib/origin/originEngine";
import { calculateDutyStack, loadHtsCodesMap } from "@/lib/tariff/dutyEngine";

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
              drawbackMatches: true,
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

  // Load HTS duty rates from the database for all line items across all filings
  const allLineItems = filings.flatMap((f) => f.shipment.lineItems).map((item) => ({
    htsCode: item.htsCode,
    countryOfOrigin: item.countryOfOrigin,
  }));
  const htsCodesMap = await loadHtsCodesMap(allLineItems);

  // Fetch exports to check drawback eligibility
  const exportItems = await db.exportLineItem.findMany({
    where: { accountId },
  });

  const opportunitiesCreated = [];

  for (const filing of filings) {
    for (const item of filing.shipment.lineItems) {
      if (!item.htsCode) continue;

      const htsRateInput = htsCodesMap[item.htsCode];
      const stack = calculateDutyStack(
        {
          htsCode: item.htsCode,
          totalValue: Number(item.totalValue || 0),
          countryOfOrigin: item.countryOfOrigin,
        },
        htsRateInput ?? null,
        "hts_rel_v1"
      );

      // Query database HtsDutyRate for active Section 301 exclusions on this HTS
      const htsExclusionRate = await db.htsDutyRate.findFirst({
        where: {
          rateType: "SECTION_301_EXCLUSION",
          exclusion: true,
          node: {
            htsNumberNormalized: item.htsCode.replace(/[^0-9]/g, ""),
          },
        },
      });

      // 1. SECTION_301_EXCLUSION: Check HtsDutyRate in DB or htsRateInput for exclusion
      const isChina = item.countryOfOrigin.toUpperCase() === "CN";
      const hasSection301Exclusion = isChina && (!!htsExclusionRate || htsRateInput?.section301Exclusion === true);

      if (hasSection301Exclusion) {
        const exists = await db.refundOpportunity.findFirst({
          where: { accountId, filingId: filing.id, opportunityType: "SECTION_301_EXCLUSION" },
        });

        if (!exists) {
          const opp = await db.refundOpportunity.create({
            data: {
              accountId,
              filingId: filing.id,
              opportunityType: "SECTION_301_EXCLUSION",
              estimatedRefundAmount: null, // Null until confirmed per spec A-4
              confidence: 95,
              basis: {
                reason: "HtsDutyRate record grants Section 301 exclusion for this HTS code.",
                lineItemId: item.id,
                htsCode: item.htsCode,
              },
              status: "Identified",
            },
          });
          opportunitiesCreated.push(opp);
        }
      }

      // 2. TRADE_AGREEMENT: Check applicable agreement based on country of origin
      const claimsTa = item.origins.length > 0;
      if (!claimsTa && item.countryOfOrigin !== "US") {
        const agreementCodeMap: Record<string, string> = {
          MX: "USMCA",
          CA: "USMCA",
          KR: "KORUS",
          CL: "US-Chile",
          SG: "US-Singapore",
          AU: "AUSFTA",
          CR: "CAFTA-DR",
          DO: "CAFTA-DR",
          SV: "CAFTA-DR",
          GT: "CAFTA-DR",
          HN: "CAFTA-DR",
          NI: "CAFTA-DR",
        };
        const targetAgreement = agreementCodeMap[item.countryOfOrigin.toUpperCase()] || "USMCA";

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
          tradeAgreementCode: targetAgreement,
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
                estimatedRefundAmount: null, // Null until confirmed per spec A-4
                confidence: 88,
                basis: {
                  reason: `Product qualifies for preferential ${targetAgreement} duty rate but was entered under general rate.`,
                  lineItemId: item.id,
                  tradeAgreementCode: targetAgreement,
                  rvcPct: originRes.regionalValueContentPct,
                },
                status: "Identified",
              },
            });
            opportunitiesCreated.push(opp);
          }
        }
      }

      // 3. CLASSIFICATION_REVIEW: Check if line item has pending classification review / alternative recommendation
      const classificationDecision = await db.classificationDecision.findFirst({
        where: { shipmentId: filing.shipment.id, htsCode: item.htsCode },
      });
      if (classificationDecision && classificationDecision.reviewStatus === "NeedsReview") {
        const exists = await db.refundOpportunity.findFirst({
          where: { accountId, filingId: filing.id, opportunityType: "CLASSIFICATION_REVIEW" },
        });
        if (!exists) {
          const opp = await db.refundOpportunity.create({
            data: {
              accountId,
              filingId: filing.id,
              opportunityType: "CLASSIFICATION_REVIEW",
              estimatedRefundAmount: null, // Null until confirmed
              confidence: 80,
              basis: {
                reason: "Classification review decision recommends re-evaluating HTS classification.",
                lineItemId: item.id,
                htsCode: item.htsCode,
              },
              status: "Identified",
            },
          });
          opportunitiesCreated.push(opp);
        }
      }

      // 4. FIRST_SALE: Check if item transaction value indicates multi-tier purchase
      const hasFirstSalePotential = item.description.toLowerCase().includes("factory") || item.description.toLowerCase().includes("middleman");
      if (hasFirstSalePotential) {
        const exists = await db.refundOpportunity.findFirst({
          where: { accountId, filingId: filing.id, opportunityType: "FIRST_SALE" },
        });
        if (!exists) {
          const opp = await db.refundOpportunity.create({
            data: {
              accountId,
              filingId: filing.id,
              opportunityType: "FIRST_SALE",
              estimatedRefundAmount: null,
              confidence: 75,
              basis: {
                reason: "Multi-tiered transaction structure detected; eligible for First Sale valuation discount.",
                lineItemId: item.id,
              },
              status: "Identified",
            },
          });
          opportunitiesCreated.push(opp);
        }
      }

      // 5. DUTY_DRAWBACK: Check if item had paid duty and matching export item exists
      const totalDutyPaid = stack.base.plus(stack.section301);
      const hasExportMatch = exportItems.some((exp) => exp.htsCode === item.htsCode);
      if (totalDutyPaid.gt(0) && hasExportMatch && item.drawbackMatches.length === 0) {
        const exists = await db.refundOpportunity.findFirst({
          where: { accountId, filingId: filing.id, opportunityType: "DUTY_DRAWBACK" },
        });
        if (!exists) {
          const opp = await db.refundOpportunity.create({
            data: {
              accountId,
              filingId: filing.id,
              opportunityType: "DUTY_DRAWBACK",
              estimatedRefundAmount: null,
              confidence: 90,
              basis: {
                reason: "Exported merchandise matches imported HTS item with un-claimed duties paid.",
                lineItemId: item.id,
                htsCode: item.htsCode,
              },
              status: "Identified",
            },
          });
          opportunitiesCreated.push(opp);
        }
      }

      // 6. AD_CVD_SCOPE_EXCLUSION: Check if AD/CVD duty applies and scope exclusion is possible
      const hasAdCvd = stack.antidumping.gt(0) || stack.countervailing.gt(0);
      if (hasAdCvd) {
        const exists = await db.refundOpportunity.findFirst({
          where: { accountId, filingId: filing.id, opportunityType: "AD_CVD_SCOPE_EXCLUSION" },
        });
        if (!exists) {
          const opp = await db.refundOpportunity.create({
            data: {
              accountId,
              filingId: filing.id,
              opportunityType: "AD_CVD_SCOPE_EXCLUSION",
              estimatedRefundAmount: null,
              confidence: 82,
              basis: {
                reason: "AD/CVD duty assessed; potential scope exclusion or non-coverage ruling opportunity.",
                lineItemId: item.id,
                htsCode: item.htsCode,
              },
              status: "Identified",
            },
          });
          opportunitiesCreated.push(opp);
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
    source: "UI",
    metadata: {
      opportunitiesCreated: opportunitiesCreated.length,
    },
  });

  return NextResponse.json({
    opportunitiesCreatedCount: opportunitiesCreated.length,
    opportunities: opportunitiesCreated.map((o) => ({
      id: o.id,
      opportunityType: o.opportunityType,
      estimatedRefundAmount: o.estimatedRefundAmount ? Number(o.estimatedRefundAmount) : null,
      confidence: o.confidence,
      status: o.status,
    })),
    message: `Scan complete. Found and created ${opportunitiesCreated.length} refund opportunities.`,
  });

}, { permission: "refunds.manage", write: true });
