import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { computeLandedCost } from "@/lib/tariff/landedCost";
import { loadHtsCodesMap } from "@/lib/tariff/dutyEngine";
import { Decimal, roundToCents } from "@/lib/tariff/decimal";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

export const POST = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { id } = paramsVal.data;

  const scenario = await db.landedCostScenario.findFirst({
    where: { id, accountId: ctx.accountId },
    include: {
      lineItems: {
        include: { htsCode: true },
      },
    },
});

  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" });
  }

  // Load HTS duty rates from the database for the scenario's line items
  const allLineItems = scenario.lineItems.map((item) => ({
    htsCode: item.htsCode.htsNumberDisplay,
  }));
  const htsCodesMap = await loadHtsCodesMap(allLineItems);

  const lineCalculations = [];
  let totalCustomsValueDec = new Decimal(0);
  let totalDutyDec = new Decimal(0);
  let totalFeesDec = new Decimal(0);
  let totalLandedCostDec = new Decimal(0);

  for (const item of scenario.lineItems) {
    // Run Landed Cost breakdown computation
    const breakdown = computeLandedCost({
      productCost: Number(item.unitValue) * item.quantity,
      quantity: item.quantity,
      htsCode: item.htsCode.htsNumberDisplay,
      countryOfOrigin: scenario.originCountry,
      freight: Number(item.freightCost),
      insurance: Number(item.insuranceCost),
    }, htsCodesMap[item.htsCode.htsNumberDisplay]);

    totalCustomsValueDec = totalCustomsValueDec.plus(breakdown.customsValue);
    totalDutyDec = totalDutyDec.plus(breakdown.baseDuty.plus(breakdown.section301).plus(breakdown.section232));
    totalFeesDec = totalFeesDec.plus(breakdown.mpf.plus(breakdown.hmf));
    totalLandedCostDec = totalLandedCostDec.plus(breakdown.total);

    // Update database row with computed values
    await db.landedCostScenarioLineItem.update({
      where: { id: item.id },
      data: {
        computedDuty: breakdown.baseDuty.plus(breakdown.section301).plus(breakdown.section232),
        computedFees: breakdown.mpf.plus(breakdown.hmf),
        computedLandedCost: breakdown.total,
        dutyStack: {
          base: breakdown.baseDuty.toNumber(),
          section301: breakdown.section301.toNumber(),
          section232: breakdown.section232.toNumber(),
          adcvd: breakdown.adcvd.toNumber(),
          mpf: breakdown.mpf.toNumber(),
          hmf: breakdown.hmf.toNumber(),
        },
      },
    });

    const customsValNum = breakdown.customsValue.toNumber();
    const effectiveRateStr = customsValNum > 0
      ? `${(breakdown.baseDuty.plus(breakdown.section301).dividedBy(breakdown.customsValue).times(100)).toNumber().toFixed(1)}%`
      : "0.0%";

    lineCalculations.push({
      id: item.id,
      description: item.description,
      htsCode: item.htsCode.htsNumberDisplay,
      customsValue: customsValNum,
      baseDuty: breakdown.baseDuty.toNumber(),
      section301: breakdown.section301.toNumber(),
      totalEffectiveDutyRate: effectiveRateStr,
      duty: breakdown.baseDuty.plus(breakdown.section301).plus(breakdown.section232).toNumber(),
      freightCost: breakdown.freightToUSPort.toNumber(),
      insuranceCost: breakdown.insuranceToUSPort.toNumber(),
    });
  }

  const roundedCustomsValue = roundToCents(totalCustomsValueDec);
  const roundedDuty = roundToCents(totalDutyDec);
  const roundedFees = roundToCents(totalFeesDec);
  const roundedLandedCost = roundToCents(totalLandedCostDec);

  const mpfSplit = roundToCents(roundedFees.times(0.7)).toNumber();
  const hmfSplit = roundToCents(roundedFees.times(0.3)).toNumber();

  return NextResponse.json({
    calculation: {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      originCountry: scenario.originCountry,
      destinationPort: scenario.destinationPort,
      totalCustomsValue: roundedCustomsValue.toNumber(),
      totalDuty: roundedDuty.toNumber(),
      totalFees: roundedFees.toNumber(),
      feeBreakdown: { mpfAmount: mpfSplit, hmfAmount: hmfSplit }, // illustrative split
      totalLandedCost: roundedLandedCost.toNumber(),
      unratedLineCount: 0,
      effectiveLandedMultiplier: roundedCustomsValue.gt(0) ? roundedLandedCost.dividedBy(roundedCustomsValue).toFixed(4) : null,
      lineCalculations,
    },
  });

}, { permission: "intel.read", write: true });
